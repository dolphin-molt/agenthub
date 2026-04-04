mod commands;

#[cfg(desktop)]
use tauri::menu::{AboutMetadata, Menu, MenuItemBuilder, PredefinedMenuItem, Submenu};
#[cfg(desktop)]
use tauri::{AppHandle, Runtime};

#[cfg(desktop)]
const RESTART_MENU_ID: &str = "restart-app";

#[cfg(desktop)]
fn build_app_menu<R: Runtime>(app_handle: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let pkg_info = app_handle.package_info();
    let config = app_handle.config();
    let app_name = pkg_info.name.clone();
    let about_metadata = AboutMetadata {
        name: Some(app_name.clone()),
        version: Some(pkg_info.version.to_string()),
        copyright: config.bundle.copyright.clone(),
        authors: config.bundle.publisher.clone().map(|publisher| vec![publisher]),
        ..Default::default()
    };

    #[cfg(target_os = "macos")]
    {
        let about = PredefinedMenuItem::about(app_handle, None, Some(about_metadata.clone()))?;
        let services = PredefinedMenuItem::services(app_handle, None)?;
        let hide = PredefinedMenuItem::hide(app_handle, None)?;
        let hide_others = PredefinedMenuItem::hide_others(app_handle, None)?;
        let quit = PredefinedMenuItem::quit(app_handle, None)?;
        let file_close_window = PredefinedMenuItem::close_window(app_handle, None)?;
        let window_close_window = PredefinedMenuItem::close_window(app_handle, None)?;
        let minimize = PredefinedMenuItem::minimize(app_handle, None)?;
        let maximize = PredefinedMenuItem::maximize(app_handle, None)?;
        let fullscreen = PredefinedMenuItem::fullscreen(app_handle, None)?;
        let separator_1 = PredefinedMenuItem::separator(app_handle)?;
        let separator_2 = PredefinedMenuItem::separator(app_handle)?;
        let separator_3 = PredefinedMenuItem::separator(app_handle)?;
        let separator_4 = PredefinedMenuItem::separator(app_handle)?;
        let separator_5 = PredefinedMenuItem::separator(app_handle)?;
        let separator_6 = PredefinedMenuItem::separator(app_handle)?;
        let restart = MenuItemBuilder::with_id(RESTART_MENU_ID, format!("Restart {app_name}"))
            .accelerator("CmdOrCtrl+Shift+R")
            .build(app_handle)?;
        let undo = PredefinedMenuItem::undo(app_handle, None)?;
        let redo = PredefinedMenuItem::redo(app_handle, None)?;
        let cut = PredefinedMenuItem::cut(app_handle, None)?;
        let copy = PredefinedMenuItem::copy(app_handle, None)?;
        let paste = PredefinedMenuItem::paste(app_handle, None)?;
        let select_all = PredefinedMenuItem::select_all(app_handle, None)?;

        let app_submenu = Submenu::with_items(
            app_handle,
            app_name,
            true,
            &[
                &about,
                &separator_1,
                &services,
                &separator_2,
                &restart,
                &separator_3,
                &hide,
                &hide_others,
                &separator_4,
                &quit,
            ],
        )?;

        let file_submenu =
            Submenu::with_items(app_handle, "File", true, &[&file_close_window])?;
        let edit_submenu = Submenu::with_items(
            app_handle,
            "Edit",
            true,
            &[
                &undo,
                &redo,
                &separator_5,
                &cut,
                &copy,
                &paste,
                &select_all,
            ],
        )?;
        let view_submenu =
            Submenu::with_items(app_handle, "View", true, &[&fullscreen])?;
        let window_submenu = Submenu::with_items(
            app_handle,
            "Window",
            true,
            &[&minimize, &maximize, &separator_6, &window_close_window],
        )?;
        let help_submenu = Submenu::with_items(app_handle, "Help", true, &[])?;

        return Menu::with_items(
            app_handle,
            &[
                &app_submenu,
                &file_submenu,
                &edit_submenu,
                &view_submenu,
                &window_submenu,
                &help_submenu,
            ],
        );
    }

    #[cfg(not(target_os = "macos"))]
    {
        Menu::default(app_handle)
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .menu(build_app_menu)
        .on_menu_event(|app, event| {
            if event.id() == RESTART_MENU_ID {
                app.request_restart();
            }
        })
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            commands::config::read_config,
            commands::config::read_config_module,
            commands::config::write_config_module,
            commands::config::get_config_path,
            commands::config::read_hub_config,
            commands::config::write_hub_config_module,
            commands::channels::get_channels_config,
            commands::channels::save_channels_config,
            commands::channels::get_gateway_worker_status,
            commands::channels::read_gateway_worker_log,
            commands::channels::stop_gateway_worker,
            commands::channels::sync_gateway_worker,
            commands::channels::get_feishu_channel_daemon_status,
            commands::channels::stop_feishu_channel_daemon,
            commands::channels::sync_feishu_channel_daemon,
            commands::channels::test_feishu_channel_connection,
            commands::custom_agents::list_custom_agents,
            commands::custom_agents::get_custom_agent,
            commands::custom_agents::upsert_custom_agent,
            commands::custom_agents::sync_custom_agent_resources,
            commands::cron::list_cron_jobs,
            commands::cron::upsert_cron_job,
            commands::cron::delete_cron_job,
            commands::cron::run_cron_job_now,
            commands::cron::poll_cron_jobs,
            commands::health::check_health,
            commands::health::detect_agents,
            commands::backup::create_backup,
            commands::backup::list_backups,
            commands::skills::list_clawhub_skills,
            commands::skills::search_clawhub_skills,
            commands::skills::get_popular_skills,
            commands::skills::get_skill_detail,
            commands::skills::get_skill_detail_convex,
            commands::skills::get_skill_readme,
            commands::monitor::get_token_usage,
            commands::monitor::get_api_usage,
            commands::monitor::fetch_provider_models,
            commands::relay::get_relay_agent_status,
            commands::relay::sync_relay_agent,
            commands::relay::stop_relay_agent,
            commands::relay::create_relay_pairing_invite,
            commands::remote::get_remote_bridge_status,
            commands::remote::sync_remote_bridge,
            commands::remote::stop_remote_bridge,
            commands::remote::read_remote_bridge_log,
            commands::memory::scan_agent_memories,
            commands::memory::get_memory_dashboard,
            commands::memory::list_memory_items,
            commands::memory::upsert_memory_item,
            commands::memory::delete_memory_item,
            commands::memory::build_chat_memory_context,
            commands::memory::append_chat_memory_record,
            commands::cli::run_openclaw_cmd,
            commands::cli::run_shell_cmd,
            commands::cli::open_terminal_command,
            commands::cli::prompt_open_microphone_settings,
            commands::cli::transcribe_audio_clip,
            commands::cli::save_audio_clip,
            commands::cli::run_claude_sdk_cmd,
            commands::cli::github_oauth_login,
            commands::cli::openclaw_config_get,
            commands::cli::openclaw_config_set,
            commands::cli::write_json_file,
            commands::cli::read_json_file,
            commands::cli::launch_agent,
            commands::cli::kill_agent,
            commands::cli::scan_directory_items,
            commands::cli::uninstall_skill,
            commands::cli::list_marketplace_plugins,
            commands::cli::scan_directory_tree,
            commands::cli::read_text_file,
            commands::collaboration::list_connectors,
            commands::collaboration::upsert_connector,
            commands::collaboration::delete_connector,
            commands::collaboration::list_threads,
            commands::collaboration::create_thread,
            commands::collaboration::rename_thread,
            commands::collaboration::set_thread_primary_agent,
            commands::collaboration::get_thread_bundle,
            commands::collaboration::upsert_board,
            commands::collaboration::create_board_task,
            commands::collaboration::list_thread_sessions,
            commands::collaboration::ensure_thread_session,
            commands::collaboration::update_thread_session,
            commands::collaboration::create_handoff_packet,
            commands::collaboration::record_thread_event,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
