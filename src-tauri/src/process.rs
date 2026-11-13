use std::io::{self, Read};
use std::process::{Child, Command, Output, Stdio};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

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

/// `Command::output` within `limit`: past it, the command is stopped with every process it
/// started, and the call fails with `TimedOut`. A CLI waiting on a network that never
/// answers must not hold its caller forever.
pub fn output_within(command: &mut Command, limit: Duration) -> io::Result<Output> {
    let mut child = command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()?;
    // Read as it comes: a full pipe would block the command before it ends.
    let stdout = read_all(child.stdout.take());
    let stderr = read_all(child.stderr.take());
    let deadline = Instant::now() + limit;
    let status = loop {
        if let Some(status) = child.try_wait()? {
            break status;
        }
        if Instant::now() >= deadline {
            kill_tree(&mut child);
            return Err(io::Error::new(
                io::ErrorKind::TimedOut,
                format!("no answer within {} s", limit.as_secs()),
            ));
        }
        thread::sleep(Duration::from_millis(20));
    };
    Ok(Output {
        status,
        stdout: stdout.join().unwrap_or_default(),
        stderr: stderr.join().unwrap_or_default(),
    })
}

fn read_all(pipe: Option<impl Read + Send + 'static>) -> JoinHandle<Vec<u8>> {
    thread::spawn(move || {
        let mut bytes = Vec::new();
        if let Some(mut pipe) = pipe {
            let _ = pipe.read_to_end(&mut bytes);
        }
        bytes
    })
}

/// Stops `child` and, on Windows, the processes under it: `taskkill /T` finds them from
/// their parent, so it runs while the parent still does.
fn kill_tree(child: &mut Child) {
    #[cfg(windows)]
    {
        let pid = child.id().to_string();
        let _ = hide_window(Command::new("taskkill").args(["/F", "/T", "/PID", &pid])).output();
    }
    let _ = child.kill();
    let _ = child.wait();
}

/// Everything a terminal's process starts, down to its children's children, ended with it: an agent's Bash tool,
/// the dev server it ran, its MCP servers, a program started hidden. Closing a terminal's pseudo console ends only
/// the processes attached to it; those in a hidden console of their own lived on.
///
/// On Windows, a job object the process is put in as soon as it is spawned: what it starts joins the job, whatever
/// console it gets, and none may leave it (a job that let them would also let go those an agent's own job lets out,
/// as Node's does). `end` ends it but for the apps with a window on screen it holds (`code .`, a browser a login
/// opened) and what they started: they are the user's now. If dummyPlane crashes, Windows ends the job whole as its
/// handle closes, those apps included: a crash must not leave every dev server and MCP server behind.
/// On macOS and Linux, the process leads a session of its own (portable-pty starts it so) and its process group is
/// hung up: a shell passes that on to its jobs, so a GUI app it started in its own group gets the hang-up too, and
/// most close on it; one started through `open` (macOS) or `xdg-open`, or with `nohup` or `setsid`, is not in it.
///
/// A command run outside a terminal is stopped by `output_within` instead (`kill_tree`), only past its limit: a
/// job closed after each run would also end the helpers it leaves running on purpose (a credential cache).
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
    use std::collections::{HashMap, HashSet};
    use std::os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle, RawHandle};

    use windows_sys::Win32::Foundation::{CloseHandle, FILETIME, HANDLE, HWND, LPARAM};
    use windows_sys::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, IsProcessInJob,
        JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE, JOBOBJECT_BASIC_PROCESS_ID_LIST,
        JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JobObjectBasicProcessIdList,
        JobObjectExtendedLimitInformation, QueryInformationJobObject, SetInformationJobObject,
        TerminateJobObject,
    };
    use windows_sys::Win32::System::Threading::{
        GetExitCodeProcess, GetProcessTimes, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION,
        PROCESS_TERMINATE, TerminateProcess,
    };
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        EnumWindows, GetClassNameW, GetWindowThreadProcessId, IsWindowVisible,
    };
    use windows_sys::core::BOOL;

    /// How many times the job is looked at again while it ends: a process may have started another meanwhile.
    const ROUNDS: usize = 5;
    /// `GetExitCodeProcess`'s answer for a process that runs.
    const STILL_ACTIVE: u32 = 259;

    /// A job whose processes end when it is ended, but for the windowed apps it holds (`spared`); and all of them
    /// when its handle closes while it was never ended (a crash).
    pub struct Job(HANDLE);

    /// A process of the job, as `spared` reads it.
    #[derive(Debug, Clone, Copy)]
    pub struct Info {
        pub pid: u32,
        pub parent: u32,
        /// When it was created (`GetProcessTimes`): a child is created after its parent.
        pub created: u64,
    }

    /// A process of the job, held open: its pid cannot go to another process while it is.
    struct Member {
        info: Info,
        handle: OwnedHandle,
    }

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

        /// Ends the job's processes, its first one with exit code 1 as `TerminateProcess` did, but the apps with a
        /// window on screen and what they started (`spared`). Those spared live on: the job no longer ends them
        /// when its handle closes. A window that appears while the job ends is seen at the next round.
        pub fn end(&self) {
            let mut kept = false;
            for _ in 0..ROUNDS {
                let members = self.members();
                let infos: Vec<Info> = members.iter().map(|member| member.info).collect();
                let spared = spared(&infos, &windowed());
                if spared.is_empty() {
                    // SAFETY: the handle is this job's, open until it drops.
                    unsafe { TerminateJobObject(self.0, 1) };
                    return;
                }
                kept = true;
                let doomed: Vec<&Member> = members
                    .iter()
                    .filter(|member| !spared.contains(&member.info.pid))
                    .collect();
                if doomed.is_empty() {
                    break;
                }
                for member in doomed {
                    // SAFETY: a handle opened with PROCESS_TERMINATE, held by `member`.
                    unsafe { TerminateProcess(member.handle.as_raw_handle() as HANDLE, 1) };
                }
            }
            if kept {
                self.spare_on_close();
            }
        }

        /// What runs in the job, each held open and checked to be the job's (its pid may have gone to another
        /// process since the list was read). Those already ending are left out.
        fn members(&self) -> Vec<Member> {
            let pids = self.pids();
            let parents: HashMap<u32, u32> = crate::pty::watch::processes()
                .into_iter()
                .map(|proc| (proc.pid, proc.parent))
                .collect();
            pids.into_iter()
                .filter_map(|pid| {
                    // SAFETY: the handle opened is owned at once; the calls are given room for what they write.
                    unsafe {
                        let raw = OpenProcess(
                            PROCESS_TERMINATE | PROCESS_QUERY_LIMITED_INFORMATION,
                            0,
                            pid,
                        );
                        if raw.is_null() {
                            return None;
                        }
                        let handle = OwnedHandle::from_raw_handle(raw as RawHandle);
                        let mut inside: BOOL = 0;
                        if IsProcessInJob(raw, self.0, &mut inside) == 0 || inside == 0 {
                            return None;
                        }
                        let mut code = 0u32;
                        if GetExitCodeProcess(raw, &mut code) == 0 || code != STILL_ACTIVE {
                            return None;
                        }
                        let mut times = [FILETIME::default(); 4];
                        let [created, exited, kernel, user] = &mut times;
                        if GetProcessTimes(raw, created, exited, kernel, user) == 0 {
                            return None;
                        }
                        let created = (u64::from(created.dwHighDateTime) << 32)
                            | u64::from(created.dwLowDateTime);
                        let parent = parents.get(&pid).copied().unwrap_or(0);
                        Some(Member {
                            info: Info {
                                pid,
                                parent,
                                created,
                            },
                            handle,
                        })
                    }
                })
                .collect()
        }

        /// The pids of the job's processes, as Windows lists them.
        fn pids(&self) -> Vec<u32> {
            let header = std::mem::offset_of!(JOBOBJECT_BASIC_PROCESS_ID_LIST, ProcessIdList)
                / size_of::<usize>();
            let mut room = 64;
            loop {
                let mut buffer = vec![0usize; header + room];
                // SAFETY: the buffer is as long as the call is told, and aligned for the list it fills.
                let read = unsafe {
                    QueryInformationJobObject(
                        self.0,
                        JobObjectBasicProcessIdList,
                        buffer.as_mut_ptr().cast(),
                        (buffer.len() * size_of::<usize>()) as u32,
                        std::ptr::null_mut(),
                    )
                };
                // SAFETY: the buffer starts with the list's header, whether the call filled it whole or not.
                let list = unsafe { &*buffer.as_ptr().cast::<JOBOBJECT_BASIC_PROCESS_ID_LIST>() };
                let assigned = list.NumberOfAssignedProcesses as usize;
                let listed = (list.NumberOfProcessIdsInList as usize).min(room);
                if (read == 0 || listed < assigned) && room < 65_536 {
                    room = (assigned + 16).max(room * 2);
                    continue;
                }
                return buffer[header..header + listed]
                    .iter()
                    .map(|&pid| pid as u32)
                    .collect();
            }
        }

        /// Its handle's closing no longer ends what it holds: the apps it spared stay open once the terminal is gone.
        fn spare_on_close(&self) {
            let limits = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
            // SAFETY: the handle is this job's; the limits are as long as the call is told.
            unsafe {
                SetInformationJobObject(
                    self.0,
                    JobObjectExtendedLimitInformation,
                    (&raw const limits).cast(),
                    size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
                )
            };
        }
    }

    /// The class of the window Windows gives a console program of its own console: Windows names that program
    /// its owner, but it is a console process (`start` in cmd, an agent's `Start-Process` server), not an app.
    const CONSOLE_WINDOW: &str = "ConsoleWindowClass";

    /// Whether `window` is a console's.
    ///
    /// # Safety
    /// `window` is a window `EnumWindows` handed.
    unsafe fn is_console(window: HWND) -> bool {
        let mut class = [0u16; 64];
        // SAFETY: the buffer is as long as the call is told.
        let len = unsafe { GetClassNameW(window, class.as_mut_ptr(), class.len() as i32) };
        len > 0 && String::from_utf16_lossy(&class[..len as usize]) == CONSOLE_WINDOW
    }

    /// The processes that own a visible top-level window, on the whole desktop, a console's window left out.
    pub fn windowed() -> HashSet<u32> {
        unsafe extern "system" fn each(window: HWND, found: LPARAM) -> BOOL {
            // SAFETY: `found` is the set `windowed` lends for the time of `EnumWindows`.
            unsafe {
                if IsWindowVisible(window) != 0 && !is_console(window) {
                    let mut pid = 0u32;
                    GetWindowThreadProcessId(window, &mut pid);
                    if pid != 0 {
                        (*(found as *mut HashSet<u32>)).insert(pid);
                    }
                }
            }
            1
        }
        let mut found = HashSet::new();
        // SAFETY: the callback only adds to `found`, which outlives the call.
        unsafe { EnumWindows(Some(each), &raw mut found as LPARAM) };
        found
    }

    /// Which of a job's processes stay when it ends: those with a window on screen (`windowed`), and what they
    /// started, down to the last child (Chrome's and VS Code's windowless helpers). A parent is known by its pid,
    /// which goes to another process once it ended: a process is the child only of one created before it.
    pub fn spared(members: &[Info], windowed: &HashSet<u32>) -> HashSet<u32> {
        let created: HashMap<u32, u64> = members
            .iter()
            .map(|member| (member.pid, member.created))
            .collect();
        let mut spared: HashSet<u32> = members
            .iter()
            .filter(|member| windowed.contains(&member.pid))
            .map(|member| member.pid)
            .collect();
        loop {
            let more: Vec<u32> = members
                .iter()
                .filter(|member| {
                    !spared.contains(&member.pid)
                        && spared.contains(&member.parent)
                        && created
                            .get(&member.parent)
                            .is_some_and(|&parent| parent <= member.created)
                })
                .map(|member| member.pid)
                .collect();
            if more.is_empty() {
                return spared;
            }
            spared.extend(more);
        }
    }

    impl Drop for Job {
        fn drop(&mut self) {
            // SAFETY: closed once, here. What still runs in a job never ended ends with it (KILL_ON_JOB_CLOSE).
            unsafe { CloseHandle(self.0) };
        }
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        fn info(pid: u32, parent: u32, created: u64) -> Info {
            Info {
                pid,
                parent,
                created,
            }
        }

        #[test]
        fn spares_the_windowed_apps_and_what_they_started_and_nothing_else() {
            let members = [
                // The terminal's shell, an agent under it, its dev server: no window.
                info(10, 1, 100),
                info(11, 10, 110),
                info(12, 11, 120),
                // A browser the agent opened (its window), a helper of the browser, and the helper's own child.
                info(20, 11, 200),
                info(21, 20, 210),
                info(22, 21, 220),
            ];
            let windowed = HashSet::from([20, 999]);
            assert_eq!(spared(&members, &windowed), HashSet::from([20, 21, 22]));
            // No window: nothing stays.
            assert!(spared(&members, &HashSet::new()).is_empty());
        }

        #[test]
        fn a_parent_pid_given_back_to_a_windowed_app_spares_no_older_process() {
            // 30's parent ended, and its pid went to a browser created later: 30 is not the browser's.
            let members = [info(30, 40, 100), info(40, 1, 500), info(41, 40, 600)];
            assert_eq!(
                spared(&members, &HashSet::from([40])),
                HashSet::from([40, 41])
            );
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stops_a_command_past_its_limit() {
        let mut command = if cfg!(windows) {
            let mut ping = Command::new("ping");
            ping.args(["-n", "30", "127.0.0.1"]);
            ping
        } else {
            let mut sleep = Command::new("sleep");
            sleep.arg("30");
            sleep
        };
        let started = Instant::now();
        let error = output_within(&mut command, Duration::from_millis(500)).unwrap_err();
        assert_eq!(error.kind(), io::ErrorKind::TimedOut);
        assert!(started.elapsed() < Duration::from_secs(10));
    }

    #[test]
    fn gives_the_output_of_a_command_that_ends_in_time() {
        let output = output_within(
            Command::new("git").arg("--version"),
            Duration::from_secs(30),
        )
        .unwrap();
        assert!(output.status.success());
        assert!(String::from_utf8_lossy(&output.stdout).starts_with("git version"));
    }

    #[cfg(windows)]
    #[test]
    fn stops_the_processes_the_command_started_too() {
        use std::os::windows::process::CommandExt;
        let dir = tempfile::tempdir().unwrap();
        let beats = dir.path().join("beats.txt");
        // A shell under the shell, writing a line a second for a minute: stopping only
        // its parent would leave it writing.
        let mut command = Command::new("cmd");
        command.current_dir(dir.path()).raw_arg(
            r#"/C cmd /C "for /L %i in (1,1,60) do @(echo %i>>beats.txt & ping -n 2 127.0.0.1 >nul)""#,
        );
        let error = output_within(&mut command, Duration::from_millis(2500)).unwrap_err();
        assert_eq!(error.kind(), io::ErrorKind::TimedOut);
        let written = std::fs::read_to_string(&beats).unwrap();
        assert!(!written.is_empty(), "the inner shell never started");
        thread::sleep(Duration::from_millis(2500));
        assert_eq!(std::fs::read_to_string(&beats).unwrap(), written);
    }

    /// dummyPlane's exit, the installer's after an update or a crash closes the job's handle without ending it:
    /// Windows ends what it holds, a terminal still being started when its tree was ended included.
    #[cfg(windows)]
    #[test]
    fn a_job_ends_its_processes_when_its_handle_closes() {
        use std::os::windows::io::AsRawHandle;
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
