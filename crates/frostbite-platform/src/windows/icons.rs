//! Desktop icon rectangles.
//!
//! The desktop is a `SysListView32` owned by explorer.exe, under
//! `Progman\SHELLDLL_DefView` (or a `WorkerW` once a wallpaper slideshow or
//! similar has run). List-view messages that return data need a buffer *in
//! explorer's address space*, so we keep one 16-byte allocation there
//! (`VirtualAllocEx`) and read results back with `ReadProcessMemory`.
//!
//! To keep the cross-process footprint minimal, each refresh does exactly one
//! write (the `LVIR_ICON` selector for item 0's icon rect). Every other icon
//! comes from `LVM_GETITEMPOSITION`, which only outputs. On the desktop all
//! icons share one size and offset, so item 0's icon rect relative to its
//! position applies to all of them.
//!
//! Anything failing → `None`, and the app simply has no icon ledges.

use std::ffi::c_void;

use windows::core::{w, BOOL, PCWSTR};
use windows::Win32::Foundation::{CloseHandle, HANDLE, HWND, LPARAM, POINT, RECT, WPARAM};
use windows::Win32::Graphics::Gdi::ClientToScreen;
use windows::Win32::System::Diagnostics::Debug::{ReadProcessMemory, WriteProcessMemory};
use windows::Win32::System::Memory::{
    VirtualAllocEx, VirtualFreeEx, MEM_COMMIT, MEM_RELEASE, MEM_RESERVE, PAGE_READWRITE,
};
use windows::Win32::System::Threading::{
    OpenProcess, PROCESS_VM_OPERATION, PROCESS_VM_READ, PROCESS_VM_WRITE,
};
use windows::Win32::UI::WindowsAndMessaging::{
    EnumWindows, FindWindowExW, FindWindowW, GetWindowThreadProcessId, IsWindow, IsWindowVisible,
    SendMessageTimeoutW, SMTO_ABORTIFHUNG, SMTO_NORMAL,
};

use crate::Rect;

const LVM_FIRST: u32 = 0x1000;
const LVM_GETITEMCOUNT: u32 = LVM_FIRST + 4;
const LVM_GETITEMRECT: u32 = LVM_FIRST + 14;
const LVM_GETITEMPOSITION: u32 = LVM_FIRST + 16;
const LVIR_ICON: i32 = 1;
/// Plenty for any real desktop; bounds the work per refresh.
const MAX_ICONS: usize = 400;
const TIMEOUT_MS: u32 = 50;
const BUF: usize = 16; // max(RECT, POINT)

/// A live connection to the desktop list view. Dropping it frees the remote
/// buffer and closes the process handle.
pub struct IconReader {
    lv: HWND,
    process: HANDLE,
    remote: *mut c_void,
}

// Raw handles are only used under the platform's Mutex.
unsafe impl Send for IconReader {}

impl Drop for IconReader {
    fn drop(&mut self) {
        unsafe {
            let _ = VirtualFreeEx(self.process, self.remote, 0, MEM_RELEASE);
            let _ = CloseHandle(self.process);
        }
    }
}

unsafe extern "system" fn find_defview(h: HWND, data: LPARAM) -> BOOL {
    if let Ok(dv) = FindWindowExW(Some(h), None, w!("SHELLDLL_DefView"), PCWSTR::null()) {
        if !dv.is_invalid() {
            *(data.0 as *mut HWND) = dv;
            return BOOL(0); // stop
        }
    }
    BOOL(1)
}

unsafe fn find_listview() -> Option<HWND> {
    let progman = FindWindowW(w!("Progman"), PCWSTR::null()).ok()?;
    let mut defview = FindWindowExW(Some(progman), None, w!("SHELLDLL_DefView"), PCWSTR::null())
        .ok()
        .filter(|h| !h.is_invalid());
    if defview.is_none() {
        // Moved under a WorkerW (happens after wallpaper/slideshow changes).
        let mut found = HWND::default();
        let _ = EnumWindows(Some(find_defview), LPARAM(&mut found as *mut HWND as isize));
        if !found.is_invalid() {
            defview = Some(found);
        }
    }
    let lv = FindWindowExW(defview, None, w!("SysListView32"), PCWSTR::null()).ok()?;
    (!lv.is_invalid()).then_some(lv)
}

impl IconReader {
    pub fn open() -> Option<Self> {
        unsafe {
            let lv = find_listview()?;
            let mut pid = 0u32;
            GetWindowThreadProcessId(lv, Some(&mut pid));
            if pid == 0 {
                return None;
            }
            let process =
                OpenProcess(PROCESS_VM_OPERATION | PROCESS_VM_READ | PROCESS_VM_WRITE, false, pid).ok()?;
            let remote = VirtualAllocEx(process, None, BUF, MEM_COMMIT | MEM_RESERVE, PAGE_READWRITE);
            if remote.is_null() {
                let _ = CloseHandle(process);
                return None;
            }
            Some(Self { lv, process, remote })
        }
    }

    /// Still talking to a live list view (explorer may have restarted).
    pub fn alive(&self) -> bool {
        unsafe { IsWindow(Some(self.lv)).as_bool() }
    }

    unsafe fn send(&self, msg: u32, wp: usize, lp: isize) -> Option<usize> {
        let mut out = 0usize;
        let ok = SendMessageTimeoutW(
            self.lv,
            msg,
            WPARAM(wp),
            LPARAM(lp),
            SMTO_ABORTIFHUNG | SMTO_NORMAL,
            TIMEOUT_MS,
            Some(&mut out),
        );
        (ok.0 != 0).then_some(out)
    }

    unsafe fn read<T: Default>(&self) -> Option<T> {
        let mut v = T::default();
        ReadProcessMemory(
            self.process,
            self.remote,
            &mut v as *mut T as *mut c_void,
            std::mem::size_of::<T>(),
            None,
        )
        .ok()?;
        Some(v)
    }

    unsafe fn item_position(&self, i: usize) -> Option<POINT> {
        let ok = self.send(LVM_GETITEMPOSITION, i, self.remote as isize)?;
        if ok == 0 {
            return None;
        }
        self.read::<POINT>()
    }

    /// Icon image rects in virtual-screen physical px. `Some(empty)` when icons
    /// are hidden ("Show desktop icons" off).
    pub fn icons(&self) -> Option<Vec<Rect>> {
        unsafe {
            if !IsWindowVisible(self.lv).as_bool() {
                return Some(Vec::new());
            }
            let count = self.send(LVM_GETITEMCOUNT, 0, 0)?.min(MAX_ICONS);
            if count == 0 {
                return Some(Vec::new());
            }

            // The single write: ask for item 0's icon rect (selector in .left).
            let sel = RECT { left: LVIR_ICON, ..Default::default() };
            WriteProcessMemory(
                self.process,
                self.remote,
                &sel as *const RECT as *const c_void,
                std::mem::size_of::<RECT>(),
                None,
            )
            .ok()?;
            if self.send(LVM_GETITEMRECT, 0, self.remote as isize)? == 0 {
                return None;
            }
            let r0: RECT = self.read()?;
            let p0 = self.item_position(0)?;
            let (dx, dy) = (r0.left - p0.x, r0.top - p0.y);
            let (w, h) = (r0.right - r0.left, r0.bottom - r0.top);
            if w <= 0 || h <= 0 {
                return None;
            }

            let mut out = Vec::with_capacity(count);
            for i in 0..count {
                let Some(p) = self.item_position(i) else { continue };
                let mut pt = POINT { x: p.x + dx, y: p.y + dy };
                if !ClientToScreen(self.lv, &mut pt).as_bool() {
                    return None;
                }
                out.push(Rect::new(pt.x, pt.y, w, h));
            }
            Some(out)
        }
    }
}
