use std::process::Command;

/// A GUI app on Windows opens a console window for every child process unless it
/// asks not to; git and ollama are run this way.
pub fn hide_window(command: &mut Command) -> &mut Command {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    command
}

/// Everything a terminal's process starts, down to its children's children, ended with it: an agent's Bash tool,
/// the dev server it ran, its MCP servers, a program started hidden. Closing a terminal's pseudo console ends only
/// the processes attached to it; those in a hidden console of their own lived on.
///
/// On Windows, a job object the process is put in as soon as it is spawned: what it starts joins the job, whatever
/// console it gets, and none may leave it (a job that let them would also let go those an agent's own job lets out,
/// as Node's does). The job is ended by `end`, and by Windows once its handle closes, dummyPlane's exit or crash
/// included. On macOS and Linux, the process leads a session of its own (portable-pty starts it so) and its
/// process group is hung up: a shell passes that on to its jobs.
pub struct ProcessTree {
    #[cfg(windows)]
    job: Option<job::Job>,
    #[cfg(unix)]
    leader: Option<u32>,
}

impl ProcessTree {
    /// The tree of `child`, just spawned. One Windows does not let into a job is still ended alone, by its
    /// `ChildKiller`, as before.
    pub fn adopt(child: &dyn portable_pty::Child) -> Self {
        #[cfg(windows)]
        {
            let job = child.as_raw_handle().and_then(|process| {
                job::Job::holding(process)
                    .inspect_err(|err| {
                        log::warn!("a terminal's processes were not put in a job: {err}");
                    })
                    .ok()
            });
            Self { job }
        }
        #[cfg(unix)]
        {
            Self {
                leader: child.process_id(),
            }
        }
    }

    /// Ends every process of the tree. Idempotent: a tree already ended has none.
    pub fn end(&self) {
        #[cfg(windows)]
        if let Some(job) = &self.job {
            job.end();
        }
        #[cfg(unix)]
        if let Some(leader) = self.leader {
            unsafe extern "C" {
                fn killpg(pgrp: i32, sig: i32) -> i32;
            }
            const SIGHUP: i32 = 1;
            // SAFETY: signals the process group the terminal's process leads, and nothing else.
            unsafe { killpg(leader as i32, SIGHUP) };
        }
    }
}

#[cfg(windows)]
mod job {
    use std::os::windows::io::RawHandle;

    use windows_sys::Win32::Foundation::{CloseHandle, HANDLE};
    use windows_sys::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
        JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JobObjectExtendedLimitInformation,
        SetInformationJobObject, TerminateJobObject,
    };

    /// A job whose processes all end when it is ended, or when its handle closes.
    pub struct Job(HANDLE);

    // SAFETY: a job's handle may be used and closed from any thread.
    unsafe impl Send for Job {}
    unsafe impl Sync for Job {}

    impl Job {
        /// A new job holding `process`, the handle its spawn returned.
        pub fn holding(process: RawHandle) -> std::io::Result<Self> {
            // SAFETY: the handle made here is the `Job`'s, closed when it drops, a failure below included; the
            // limits are as long as the call is told.
            unsafe {
                let handle = CreateJobObjectW(std::ptr::null(), std::ptr::null());
                if handle.is_null() {
                    return Err(std::io::Error::last_os_error());
                }
                let job = Job(handle);
                let mut limits = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
                limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
                let set = SetInformationJobObject(
                    job.0,
                    JobObjectExtendedLimitInformation,
                    (&raw const limits).cast(),
                    size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
                );
                if set == 0 || AssignProcessToJobObject(job.0, process as HANDLE) == 0 {
                    return Err(std::io::Error::last_os_error());
                }
                Ok(job)
            }
        }

        /// Ends every process in the job, its first one with exit code 1, as `TerminateProcess` did.
        pub fn end(&self) {
            // SAFETY: the handle is this job's, open until it drops.
            unsafe { TerminateJobObject(self.0, 1) };
        }
    }

    impl Drop for Job {
        fn drop(&mut self) {
            // SAFETY: closed once, here. What still runs in the job ends with it (KILL_ON_JOB_CLOSE).
            unsafe { CloseHandle(self.0) };
        }
    }
}

#[cfg(all(test, windows))]
mod tests {
    use std::os::windows::io::AsRawHandle;
    use std::process::Stdio;
    use std::time::{Duration, Instant};

    use super::*;

    /// dummyPlane's exit, the installer's after an update or a crash closes the job's handle without ending it:
    /// Windows ends what it holds, a terminal still being started when its tree was ended included.
    #[test]
    fn a_job_ends_its_processes_when_its_handle_closes() {
        let mut command = Command::new("ping");
        hide_window(&mut command)
            .args(["-n", "30", "127.0.0.1"])
            .stdout(Stdio::null());
        let mut ping = command.spawn().unwrap();
        let job = job::Job::holding(ping.as_raw_handle()).unwrap();
        assert!(ping.try_wait().unwrap().is_none());
        drop(job);
        let deadline = Instant::now() + Duration::from_secs(5);
        let ended = loop {
            if ping.try_wait().unwrap().is_some() {
                break true;
            }
            if Instant::now() >= deadline {
                break false;
            }
            std::thread::sleep(Duration::from_millis(20));
        };
        // This test's own, if Windows left it.
        let _ = ping.kill();
        assert!(ended, "the ping outlived its job's handle");
    }
}
