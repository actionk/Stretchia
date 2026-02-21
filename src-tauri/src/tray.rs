use tauri::{
    AppHandle, Emitter, Manager, Runtime,
    tray::{TrayIconBuilder, MouseButton, MouseButtonState, TrayIconEvent},
    menu::{MenuBuilder, MenuItemBuilder},
    image::Image,
};
use crate::timer::Stage;

pub fn create_tray<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    let show = MenuItemBuilder::with_id("show", "Show Window").build(app)?;
    let stretch = MenuItemBuilder::with_id("stretch_now", "Stretch Now").build(app)?;
    let stats = MenuItemBuilder::with_id("stats", "Statistics").build(app)?;
    let settings = MenuItemBuilder::with_id("settings", "Settings").build(app)?;
    let quit = MenuItemBuilder::with_id("quit", "Quit").build(app)?;
    let menu = MenuBuilder::new(app)
        .item(&show)
        .item(&stretch)
        .item(&stats)
        .item(&settings)
        .separator()
        .item(&quit)
        .build()?;

    let icon = make_icon(&Stage::Green);

    let _tray = TrayIconBuilder::new()
        .icon(icon)
        .menu(&menu)
        .tooltip("Stretchia")
        .on_menu_event(move |app, event| {
            match event.id().as_ref() {
                "show" => {
                    if let Some(w) = app.get_webview_window("main") {
                        let _ = w.show();
                        let _ = w.set_focus();
                    }
                }
                "stretch_now" => {
                    let _ = app.emit("tray-stretch", ());
                }
                "stats" => {
                    let _ = app.emit("tray-stats", ());
                }
                "settings" => {
                    let _ = app.emit("tray-settings", ());
                }
                "quit" => {
                    app.exit(0);
                }
                _ => {}
            }
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let app = tray.app_handle();
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.show();
                    let _ = w.set_focus();
                }
            }
        })
        .build(app)?;

    Ok(())
}

pub fn make_icon(stage: &Stage) -> Image<'static> {
    let (r, g, b) = match stage {
        Stage::Green => (74, 222, 128),
        Stage::Yellow => (250, 204, 21),
        Stage::Orange => (251, 146, 60),
        Stage::Red | Stage::Critical => (239, 68, 68),
    };

    let size = 16u32;
    let mut rgba = Vec::with_capacity((size * size * 4) as usize);
    let center = (size / 2) as f32;
    let radius = center - 1.0;

    for y in 0..size {
        for x in 0..size {
            let dx = x as f32 - center;
            let dy = y as f32 - center;
            let dist = (dx * dx + dy * dy).sqrt();
            if dist <= radius {
                rgba.extend_from_slice(&[r, g, b, 255]);
            } else if dist <= radius + 1.0 {
                let alpha = ((radius + 1.0 - dist) * 255.0) as u8;
                rgba.extend_from_slice(&[r, g, b, alpha]);
            } else {
                rgba.extend_from_slice(&[0, 0, 0, 0]);
            }
        }
    }

    Image::new_owned(rgba, size, size)
}

pub fn update_tray_icon<R: Runtime>(app: &AppHandle<R>, stage: &Stage) {
    if let Some(tray) = app.tray_by_id("main") {
        let icon = make_icon(stage);
        let _ = tray.set_icon(Some(icon));
    }
}
