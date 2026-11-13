//! Helpers shared by the command tests that run real terminals (Windows only).

use std::sync::mpsc;

use crate::pty::session::OutputSink;
use crate::pty::shell::SpawnPlan;
use crate::pty::{PtyManager, pty_size};

pub struct NullSink;

impl OutputSink for NullSink {
    fn send(&self, _bytes: &[u8]) -> bool {
        true
    }
}

/// Starts an idle cmd.exe for `node_id`; the receiver fires when it exits.
pub fn run_terminal(pty: &PtyManager, node_id: &str) -> mpsc::Receiver<()> {
    let plan = SpawnPlan {
        program: "cmd.exe".into(),
        args: vec![],
        cwd: std::env::temp_dir(),
        env: vec![],
        env_remove: vec![],
        initial_input: None,
        interrupt: None,
        watch_agents: false,
    };
    let (tx, rx) = mpsc::channel();
    pty.spawn(
        node_id,
        plan,
        pty_size(80, 24),
        Box::new(NullSink),
        Box::new(|| {}),
        move |_| {
            let _ = tx.send(());
        },
    )
    .unwrap();
    rx
}
