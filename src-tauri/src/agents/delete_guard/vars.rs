//! The variables a script has set so far, for the guard to expand the paths it deletes.

use std::collections::HashMap;

/// What a script (or the script of a `bash -c` inside it) has assigned. A name set to `None` holds
/// something only the running shell knows (a loop variable, a command's output): it is not
/// the value it had before.
#[derive(Default)]
pub(super) struct Vars<'p> {
    parent: Option<&'p Vars<'p>>,
    set: HashMap<String, Option<String>>,
}

impl<'p> Vars<'p> {
    /// What a nested script sees: the variables of the script that runs it, and its own.
    pub fn child(parent: &'p Vars<'p>) -> Self {
        Vars {
            parent: Some(parent),
            set: HashMap::new(),
        }
    }

    pub fn set(&mut self, name: String, value: Option<String>) {
        self.set.insert(name, value);
    }

    /// `Some(None)`: set, to something not known; `None`: never set here.
    pub fn get(&self, name: &str) -> Option<&Option<String>> {
        self.set
            .get(name)
            .or_else(|| self.parent.and_then(|parent| parent.get(name)))
    }
}
