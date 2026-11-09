//! Locks that outlive a panic: a thread that panicked while holding one must
//! not take persistence or the terminals down with it (spec première version §3.5).

use std::sync::{Mutex, MutexGuard, PoisonError};

/// The guard, even when a panicking thread poisoned the mutex: the data of
/// every lock in dummyPlane stays consistent between two statements.
pub fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;

    #[test]
    fn a_poisoned_mutex_still_locks() {
        let shared = Arc::new(Mutex::new(1));
        let poisoner = shared.clone();
        let _ = std::thread::spawn(move || {
            let _guard = poisoner.lock().unwrap();
            panic!("poison");
        })
        .join();
        assert!(shared.is_poisoned());
        *lock(&shared) += 1;
        assert_eq!(*lock(&shared), 2);
    }
}
