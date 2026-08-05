export type Decision = "ask" | "allow_always" | "deny";
export type Importance = "Critical" | "High" | "Medium" | "Low";

export interface ShreeSettings {
  setup_completed: boolean; language: "Auto"|"English"|"Hindi"; theme: "Dark"|"Light"|"Auto"; accent_color: string; animation_speed: "Reduced"|"Normal"|"Fast";
  minimize_to_tray: boolean; start_minimized: boolean; remember_window_position: boolean; check_updates_automatically: boolean; automatic_download_updates:boolean; automatic_install_updates:boolean; update_channel:"stable"|"beta"|"alpha"; notifications_enabled: boolean;
  floating_mode_enabled:boolean; start_in_floating_mode:boolean; floating_always_on_top:boolean; floating_auto_hide_fullscreen:boolean; floating_avatar_size:"Small"|"Medium"|"Large"; floating_opacity:number; floating_click_through_idle:boolean; floating_show_subtitles:boolean; floating_show_speech_bubble:boolean; floating_idle_animations:boolean; floating_lip_sync:boolean; floating_desktop_awareness:boolean; floating_proactive_suggestions:boolean; floating_voice_volume:number; floating_edge_snapping:boolean; floating_animation_quality:"Low"|"Balanced"|"High"; floating_activation_shortcut:string;
  wake_word_enabled: boolean; wake_phrases: string[]; background_listening: boolean;
  reasoning_enabled: boolean; tool_use_enabled: boolean; web_search_enabled:boolean; memory_enabled: boolean; code_execution_enabled: boolean; screen_understanding_enabled: boolean; desktop_control_enabled: boolean; assistant_voice:"Achernar"|"Vindemiatrix"|"Leda"|"Aoede"|"Kore"; v1_1_20_voice_restored:boolean;
  memory_importance_level: Importance;
  power_controls_enabled: boolean; exact_volume_enabled: boolean; keyboard_automation_enabled: boolean; mouse_automation_enabled: boolean; file_management_enabled: boolean; ocr_enabled: boolean; clipboard_access_enabled: boolean; screen_capture_enabled: boolean; clipboard_history_enabled: boolean; emergency_stop_shortcut: string; file_access_folders: string[]; application_aliases: Record<string,string>;
  audio_input_device_id: string; audio_output_device_id: string;
  desktop_notifications: boolean; sound_notifications: boolean; reminder_notifications: boolean; update_notifications: boolean; error_notifications: boolean; quiet_hours_enabled: boolean; quiet_hours_start: string; quiet_hours_end: string;
  local_only_mode: boolean; encrypt_saved_settings: boolean; plugins_enabled: boolean; plugin_states: Record<string,boolean>; mcp_servers: Array<{name:string;command:string;args:string[];enabled:boolean}>;
  hardware_acceleration: boolean; background_cpu_limit: number; memory_usage_limit_mb: number; cache_size_mb: number;
  developer_mode: boolean; debug_logs: boolean; tool_execution_logs: boolean; api_request_logs: boolean; gemini_api_validated_at: string|null;
}

export interface SetupStatus {
  ready:boolean; requires_setup:boolean; setup_completed:boolean; required_providers:string[]; missing_providers:string[];
  providers:{gemini:{configured:boolean;validated:boolean;validated_at:string|null}};
}

export const defaultSettings:ShreeSettings = {
  setup_completed:false,language:"Auto",theme:"Dark",accent_color:"#6EE7FF",animation_speed:"Normal",minimize_to_tray:true,start_minimized:false,remember_window_position:true,check_updates_automatically:true,automatic_download_updates:false,automatic_install_updates:false,update_channel:"stable",notifications_enabled:true,
  floating_mode_enabled:true,start_in_floating_mode:false,floating_always_on_top:true,floating_auto_hide_fullscreen:true,floating_avatar_size:"Medium",floating_opacity:96,floating_click_through_idle:false,floating_show_subtitles:true,floating_show_speech_bubble:true,floating_idle_animations:true,floating_lip_sync:true,floating_desktop_awareness:false,floating_proactive_suggestions:false,floating_voice_volume:82,floating_edge_snapping:true,floating_animation_quality:"Balanced",floating_activation_shortcut:"CommandOrControl+Alt+Space",
  wake_word_enabled:false,wake_phrases:["Hello Shree","Hi Shree","Hey Shree","Namaste Shree","Shree"],background_listening:false,
  reasoning_enabled:true,tool_use_enabled:true,web_search_enabled:true,memory_enabled:true,code_execution_enabled:false,screen_understanding_enabled:true,desktop_control_enabled:true,assistant_voice:"Aoede",v1_1_20_voice_restored:true,
  memory_importance_level:"Medium",
  power_controls_enabled:false,exact_volume_enabled:true,keyboard_automation_enabled:true,mouse_automation_enabled:true,file_management_enabled:true,ocr_enabled:true,clipboard_access_enabled:true,screen_capture_enabled:true,clipboard_history_enabled:false,emergency_stop_shortcut:"CommandOrControl+Alt+Shift+Escape",file_access_folders:[],application_aliases:{},
  audio_input_device_id:"default",audio_output_device_id:"default",
  desktop_notifications:true,sound_notifications:true,reminder_notifications:true,update_notifications:true,error_notifications:true,quiet_hours_enabled:false,quiet_hours_start:"22:00",quiet_hours_end:"07:00",
  local_only_mode:false,encrypt_saved_settings:false,plugins_enabled:true,plugin_states:{},mcp_servers:[],hardware_acceleration:true,background_cpu_limit:50,memory_usage_limit_mb:1024,cache_size_mb:256,
  developer_mode:false,debug_logs:false,tool_execution_logs:true,api_request_logs:false,gemini_api_validated_at:null,
};

export function applyAppearance(settings:Pick<ShreeSettings,"theme"|"accent_color"|"animation_speed">) {
  const root=document.documentElement;
  const resolved=settings.theme==="Auto"?(matchMedia("(prefers-color-scheme: light)").matches?"Light":"Dark"):settings.theme;
  root.dataset.theme=resolved.toLowerCase(); root.dataset.animation=settings.animation_speed.toLowerCase();
  root.style.setProperty("--shree-accent",settings.accent_color);
}
