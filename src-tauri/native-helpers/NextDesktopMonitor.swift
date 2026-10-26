import AppKit
import CoreGraphics
import Darwin

// Only lifecycle and window bounds are observed. No screen pixels or camera data.
func emit(_ kind: String) {
    let data = try! JSONSerialization.data(withJSONObject: ["kind": kind])
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write(Data([10]))
}
let workspace = NSWorkspace.shared.notificationCenter
let distributed = DistributedNotificationCenter.default()
var locked = false
var lastFullscreen = false
var observers: [NSObjectProtocol] = []
let owner = getppid()
for (name, kind) in [(NSWorkspace.willSleepNotification,"sleep"), (NSWorkspace.didWakeNotification,"resume")] {
    observers.append(workspace.addObserver(forName: name, object: nil, queue: .main) { _ in emit(kind) })
}
for (name, state) in [("com.apple.screenIsLocked",true), ("com.apple.screenIsUnlocked",false)] {
    observers.append(distributed.addObserver(forName: NSNotification.Name(name), object: nil, queue: .main) { _ in
        locked = state
        emit(state ? "lock" : "resume")
    })
}
observers.append(NotificationCenter.default.addObserver(forName: NSApplication.didChangeScreenParametersNotification, object: nil, queue: .main) { _ in emit("displays") })
let timer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { _ in
    // A crashed host cannot run Rust's normal child cleanup.
    if getppid() != owner || kill(owner, 0) != 0 { exit(0) }
    guard !locked, let front = NSWorkspace.shared.frontmostApplication else { return }
    if front.bundleIdentifier == "com.bigguan.jarvis-next" { if lastFullscreen { lastFullscreen=false; emit("windowed") }; return }
    let windows = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String:Any]] ?? []
    let full = windows.contains { window in
        guard (window[kCGWindowOwnerPID as String] as? Int32) == front.processIdentifier,
              (window[kCGWindowLayer as String] as? Int) == 0,
              let bounds = window[kCGWindowBounds as String] as? [String:Any],
              let rect = CGRect(dictionaryRepresentation: bounds as CFDictionary) else { return false }
        return NSScreen.screens.contains { screen in
            abs(rect.width - screen.frame.width) < 2 && abs(rect.height - screen.frame.height) < 2
        }
    }
    if full != lastFullscreen { lastFullscreen = full; emit(full ? "fullscreen" : "windowed") }
}
RunLoop.main.run()
