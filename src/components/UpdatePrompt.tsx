import { Download, RefreshCw, X } from "lucide-react";
import type { UpdateState } from "../updateTypes";

export function UpdatePrompt({state,setState}:{state:UpdateState;setState(state:UpdateState):void}) {
  if (!state.prompt || !state.availableVersion) return null;
  const downloaded=state.status==="downloaded";
  const busy=["downloading","waiting_for_tasks","installing"].includes(state.status);
  return <aside className="fixed bottom-5 right-5 z-[90] w-[360px] rounded-2xl border border-cyan-400/20 bg-[#070a12]/95 p-4 shadow-2xl backdrop-blur-xl" role="dialog" aria-label="Shree update available">
    <div className="flex items-start gap-3"><span className="rounded-xl bg-cyan-400/10 p-2 text-cyan-300">{downloaded?<RefreshCw size={17}/>:<Download size={17}/>}</span><div className="min-w-0 flex-1"><h3 className="text-sm font-semibold text-white">Shree {state.availableVersion} is ready</h3><p className="mt-1 text-[11px] leading-relaxed text-slate-400">{downloaded?"Restart to install. Your memories, settings, reminders, conversations, and API credentials stay on this PC.":"A new signed release is available. You can download it in the background."}</p></div><button aria-label="Remind me later" className="text-slate-500 hover:text-white" onClick={async()=>setState(await window.shreeDesktop!.remindUpdateLater())}><X size={15}/></button></div>
    {state.progress&&<div className="mt-3"><div className="h-1 overflow-hidden rounded bg-white/5"><div className="h-full bg-cyan-400" style={{width:`${state.progress.percent}%`}}/></div><p className="mt-1 text-right text-[9px] text-slate-500">{state.progress.percent.toFixed(1)}%</p></div>}
    {state.error&&<p className="mt-3 text-[10px] text-rose-300">{state.error}</p>}
    <div className="mt-4 flex flex-wrap gap-2 text-[10px]">
      {downloaded?<button className="rounded-lg bg-cyan-400 px-3 py-2 font-semibold text-slate-950" onClick={async()=>setState(await window.shreeDesktop!.installUpdate())}>Install & restart</button>:!busy&&<><button className="rounded-lg bg-cyan-400 px-3 py-2 font-semibold text-slate-950" onClick={async()=>setState(await window.shreeDesktop!.downloadUpdate(false))}>Update now</button><button className="rounded-lg border border-white/10 px-3 py-2 text-slate-300" onClick={async()=>setState(await window.shreeDesktop!.downloadUpdate(true))}>Download in background</button></>}
      {!downloaded&&!busy&&<button className="px-2 py-2 text-slate-500 hover:text-white" onClick={async()=>setState(await window.shreeDesktop!.skipUpdateVersion())}>Skip this version</button>}
    </div>
  </aside>;
}
