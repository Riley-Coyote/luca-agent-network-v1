//! Thin command exports for the private resident Place store.
//!
//! The store owns persistence and authorization-adjacent validation.  Keeping
//! these exports separate lets the application register the four IPC commands
//! without giving the renderer access to the broker-only agent operation.

pub(crate) use crate::luca::resident_place::{
    get_resident_place, list_resident_place_work, set_resident_place_editing, update_resident_place,
};
