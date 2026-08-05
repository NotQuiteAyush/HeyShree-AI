import { useState } from "react";
import { Memory } from "../types";
import { 
  X, 
  Brain, 
  User, 
  Sparkles, 
  Heart, 
  Briefcase, 
  Target, 
  Users, 
  Clock, 
  Zap, 
  Smile, 
  BookOpen, 
  Trash2,
  Calendar,
  Award,
  ChevronRight,
  Plus,
  Pin
} from "lucide-react";

interface MemoryBrainProps {
  memories: Memory[];
  onRemember: (category: Memory["category"], content: string, importance: Memory["importance"], pinned: boolean) => Promise<void>;
  onForget: (category: Memory["category"], content: string) => Promise<void>;
  onClose: () => void;
}

// Icon mapper for categories
const CATEGORY_ICONS: Record<Memory["category"], any> = {
  Identity: User,
  Preferences: Sparkles,
  Personality: Heart,
  Projects: Briefcase,
  Goals: Target,
  Relationships: Users,
  Schedule: Clock,
  Habits: Zap,
  Emotional: Smile,
  Semantic: BookOpen,
};

const CATEGORY_COLORS: Record<Memory["category"], string> = {
  Identity: "text-blue-400 border-blue-500/20 bg-blue-500/5",
  Preferences: "text-yellow-400 border-yellow-500/20 bg-yellow-500/5",
  Personality: "text-rose-400 border-rose-500/20 bg-rose-500/5",
  Projects: "text-emerald-400 border-emerald-500/20 bg-emerald-500/5",
  Goals: "text-cyan-400 border-cyan-500/20 bg-cyan-500/5",
  Relationships: "text-purple-400 border-purple-500/20 bg-purple-500/5",
  Schedule: "text-amber-400 border-amber-500/20 bg-amber-500/5",
  Habits: "text-orange-400 border-orange-500/20 bg-orange-500/5",
  Emotional: "text-pink-400 border-pink-500/20 bg-pink-500/5",
  Semantic: "text-indigo-400 border-indigo-500/20 bg-indigo-500/5",
};

export function MemoryBrain({ memories, onRemember, onForget, onClose }: MemoryBrainProps) {
  const [selectedTab, setSelectedTab] = useState<string>("All");
  const [showAdd, setShowAdd] = useState(false);
  const [content, setContent] = useState("");
  const [category, setCategory] = useState<Memory["category"]>("Preferences");
  const [importance, setImportance] = useState<Memory["importance"]>("Medium");
  const [pinned, setPinned] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Memory | null>(null);
  const [deleting, setDeleting] = useState(false);

  const saveMemory = async () => {
    if (content.trim().length < 2) return;
    setSaving(true); setMessage(null);
    try {
      await onRemember(category, content.trim(), importance, pinned);
      setContent(""); setPinned(false); setShowAdd(false); setMessage("Memory stored locally.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally { setSaving(false); }
  };

  const categories: string[] = [
    "All",
    "Identity",
    "Preferences",
    "Personality",
    "Projects",
    "Goals",
    "Relationships",
    "Schedule",
    "Habits",
    "Emotional",
    "Semantic",
  ];

  const filteredMemories = selectedTab === "All"
    ? memories
    : memories.filter(m => m.category === selectedTab);

  const getImportanceStyles = (importance: Memory["importance"]) => {
    switch (importance) {
      case "Critical":
        return "bg-red-500/10 border-red-500/30 text-red-400 shadow-[0_0_8px_rgba(239,68,68,0.1)]";
      case "High":
        return "bg-amber-500/10 border-amber-500/30 text-amber-400";
      case "Medium":
        return "bg-indigo-500/10 border-indigo-500/30 text-indigo-400";
      default:
        return "bg-slate-500/10 border-slate-500/30 text-slate-400";
    }
  };

  return (
    <div className="fixed inset-y-0 right-0 w-[450px] max-w-full bg-slate-950/98 border-l border-slate-900 shadow-2xl backdrop-blur-xl z-50 flex flex-col transition-all duration-300 animate-slide-in">
      {/* Header */}
      <div className="p-5 border-b border-slate-900 flex items-center justify-between bg-slate-950/50 backdrop-blur-md">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-cyan-950/50 border border-cyan-500/30 shadow-[0_0_15px_rgba(34,211,238,0.15)]">
            <Brain className="text-cyan-400 animate-pulse" size={20} />
          </div>
          <div>
            <h3 className="font-bold text-sm text-slate-100 uppercase tracking-wider">
              Shree Memory Core
            </h3>
            <p className="text-[10px] text-cyan-400/70 font-mono mt-0.5">
              Long-term neural storage layer
            </p>
          </div>
        </div>
        <button
          onClick={onClose}
          className="p-1.5 rounded-lg hover:bg-slate-900 text-slate-400 hover:text-slate-200 cursor-pointer transition-colors"
          title="Close Panel"
        >
          <X size={18} />
        </button>
      </div>

      {/* Info Card / State banner */}
      <div className="px-5 py-3.5 bg-cyan-950/10 border-b border-slate-900 flex items-center justify-between text-xs text-slate-300">
        <div className="flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-cyan-500 animate-ping"></span>
          <span className="text-[11px] font-medium text-slate-400">Total Synapses Recorded:</span>
          <span className="text-cyan-400 font-bold font-mono text-[12px]">{memories.length}</span>
        </div>
        <span className="text-[10px] text-slate-500 font-mono">Synced Real-time</span>
      </div>

      <div className="px-5 py-3 border-b border-slate-900 bg-slate-950/60">
        {showAdd ? (
          <div className="space-y-2.5">
            <textarea value={content} onChange={event => setContent(event.target.value)} rows={3} autoFocus
              placeholder="What should Shree remember?"
              className="w-full resize-none rounded-lg bg-black/30 border border-white/10 px-3 py-2 text-xs text-slate-100 outline-none focus:border-cyan-500/40" />
            <div className="flex gap-2">
              <select value={category} onChange={event => setCategory(event.target.value as Memory["category"])} className="flex-1 rounded-lg bg-slate-950 border border-white/10 px-2 py-1.5 text-[10px] text-slate-300">
                {categories.filter(item => item !== "All").map(item => <option key={item}>{item}</option>)}
              </select>
              <select value={importance} onChange={event => setImportance(event.target.value as Memory["importance"])} className="rounded-lg bg-slate-950 border border-white/10 px-2 py-1.5 text-[10px] text-slate-300">
                {(["Critical", "High", "Medium", "Low"] as const).map(item => <option key={item}>{item}</option>)}
              </select>
              <button onClick={() => setPinned(value => !value)} title="Pin memory" className={`p-2 rounded-lg border ${pinned ? "text-cyan-300 border-cyan-500/30 bg-cyan-500/10" : "text-slate-500 border-white/10"}`}><Pin size={13}/></button>
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowAdd(false)} className="px-3 py-1.5 text-[10px] text-slate-400">Cancel</button>
              <button disabled={saving || content.trim().length < 2} onClick={saveMemory} className="px-3 py-1.5 rounded-lg bg-cyan-500/15 text-[10px] text-cyan-300 disabled:opacity-40">{saving ? "Saving..." : "Save memory"}</button>
            </div>
          </div>
        ) : (
          <button onClick={() => { setShowAdd(true); setMessage(null); }} className="w-full py-2 rounded-lg border border-dashed border-cyan-500/20 text-[10px] text-cyan-400 flex items-center justify-center gap-1.5"><Plus size={11}/> Add memory</button>
        )}
        {message && <p className={`mt-2 text-[10px] ${message.includes("stored") || message.includes("deleted") ? "text-emerald-400" : "text-rose-400"}`}>{message}</p>}
      </div>

      {/* Filter Tabs */}
      <div className="border-b border-slate-900 bg-slate-950/40 p-2 overflow-x-auto scrollbar-thin">
        <div className="flex gap-1.5 min-w-max">
          {categories.map((cat) => {
            const count = cat === "All" 
              ? memories.length 
              : memories.filter(m => m.category === cat).length;
            
            const isSelected = selectedTab === cat;
            const IconComponent = cat === "All" ? Brain : CATEGORY_ICONS[cat as Memory["category"]];

            return (
              <button
                key={cat}
                onClick={() => setSelectedTab(cat)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-all cursor-pointer ${
                  isSelected
                    ? "bg-cyan-500/15 border border-cyan-500/30 text-cyan-300"
                    : "border border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-900/40"
                }`}
              >
                {IconComponent && <IconComponent size={12} className={isSelected ? "text-cyan-400" : "text-slate-500"} />}
                <span>{cat}</span>
                <span className={`text-[9px] px-1 rounded font-mono ${
                  isSelected ? "bg-cyan-400/20 text-cyan-300" : "bg-slate-900 text-slate-500"
                }`}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Memory Cards Feed */}
      <div className="flex-1 overflow-y-auto p-5 flex flex-col gap-3.5">
        {filteredMemories.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center px-6">
            <Brain size={44} className="text-slate-800 mb-3 stroke-[1.5]" />
            <span className="text-slate-400 font-semibold text-xs mb-1">No memories found</span>
            <p className="text-[11px] text-slate-600 max-w-xs leading-relaxed">
              {selectedTab === "All" 
                ? "Ask Shree to remember something. Stable preferences and details are saved locally automatically when memory is enabled, or you can add one above."
                : `No memory cards exist under the "${selectedTab}" category yet.`}
            </p>
          </div>
        ) : (
          filteredMemories.map((mem) => {
            const IconComponent = CATEGORY_ICONS[mem.category] || BookOpen;
            const catColors = CATEGORY_COLORS[mem.category] || "text-slate-300 border-slate-500/20";

            return (
              <div
                key={mem.id}
                className="group relative p-4 rounded-xl border border-slate-900 bg-slate-900/10 hover:border-slate-800 hover:bg-slate-900/30 transition-all duration-300 flex flex-col gap-3"
              >
                {/* Top Row: Category, Importance, Controls */}
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5">
                    <span className={`p-1 rounded-md border ${catColors}`}>
                      <IconComponent size={10} />
                    </span>
                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-300 font-mono">
                      {mem.category}
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    {/* Importance Badge */}
                    <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full border tracking-wide font-mono ${getImportanceStyles(mem.importance)}`}>
                      {mem.importance}
                    </span>

                    {/* Forget Privacy Button */}
                    <button
                      onClick={() => setPendingDelete(mem)}
                      className="p-1.5 rounded-lg border border-transparent hover:border-red-500/20 hover:bg-red-500/10 text-slate-500 hover:text-red-400 cursor-pointer transition-all duration-200"
                      title="Forget Memory (Privacy)"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>

                {/* Content Statement */}
                <p className="text-xs text-slate-200 leading-relaxed font-sans pr-4">
                  {mem.content}
                </p>

                {/* Footer Metadata */}
                <div className="pt-2 border-t border-slate-900/50 flex flex-wrap items-center justify-between gap-2 text-[10px] text-slate-500 font-mono">
                  {/* Times Reinforced */}
                  <div className="flex items-center gap-1">
                    <Award size={10} className="text-cyan-500/70" />
                    <span>Reinforcements: <span className="text-cyan-400 font-bold">{mem.timesReinforced}</span></span>
                  </div>

                  {/* Confidence Score */}
                  <div className="flex items-center gap-1.5">
                    <span>Confidence:</span>
                    <div className="w-12 h-1.5 bg-slate-900 rounded-full overflow-hidden border border-slate-800">
                      <div 
                        className="h-full bg-cyan-400" 
                        style={{ width: `${mem.confidence * 100}%` }}
                      ></div>
                    </div>
                    <span className="text-cyan-400 font-bold">{Math.round(mem.confidence * 100)}%</span>
                  </div>
                </div>

                {/* Date indicator */}
                <div className="text-[9px] text-slate-600 font-mono flex items-center gap-1 self-end mt-1">
                  <Calendar size={10} />
                  <span>Recorded: {new Date(mem.timestamp).toLocaleDateString()}</span>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Privacy Guarantee Footer */}
      <div className="p-4 border-t border-slate-900 bg-slate-950 flex flex-col gap-1 text-[10px] text-slate-500 text-center">
        <p className="font-semibold text-slate-400">🔒 Dynamic User Privacy & Memory Control</p>
        <p className="px-4">
          All memories are compiled locally. You can ask Shree to "Forget my favorite game" or delete cards manually using the bin icon.
        </p>
      </div>
      {pendingDelete && (
        <div className="absolute inset-0 z-20 grid place-items-center bg-black/75 p-5 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-2xl border border-rose-500/20 bg-[#0b0d17] p-5 shadow-2xl">
            <Trash2 className="text-rose-400" size={20}/>
            <h4 className="mt-3 text-sm font-semibold text-white">Delete this memory?</h4>
            <p className="mt-2 max-h-28 overflow-y-auto text-xs leading-relaxed text-slate-400">{pendingDelete.content}</p>
            <p className="mt-3 text-[10px] text-rose-300/80">This always requires your explicit confirmation and cannot be undone.</p>
            <div className="mt-5 flex justify-end gap-2">
              <button disabled={deleting} onClick={()=>setPendingDelete(null)} className="rounded-lg px-3 py-2 text-[10px] text-slate-400 hover:bg-white/5">Cancel</button>
              <button disabled={deleting} onClick={async()=>{setDeleting(true);setMessage(null);try{await onForget(pendingDelete.category,pendingDelete.content);setPendingDelete(null);setMessage("Memory deleted after confirmation.")}catch(error){setMessage(error instanceof Error?error.message:String(error))}finally{setDeleting(false)}}} className="rounded-lg border border-rose-500/20 bg-rose-500/10 px-3 py-2 text-[10px] text-rose-300 disabled:opacity-40">{deleting?"Deleting…":"Confirm deletion"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
