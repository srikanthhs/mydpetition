'use client';
import { useState, useCallback, useRef, useMemo, useEffect } from 'react';
import { GrievanceRow, AuditResult, PreStats } from '@/lib/types';
import { fsSaveRows, fsSaveResults, fsLoad, fsClear } from '@/lib/store';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell, PieChart, Pie, Legend,
  LabelList,
} from 'recharts';
import {
  Upload, Download, Play, Shield, AlertCircle, FileSpreadsheet,
  CheckCircle2, Clock, XCircle, Loader2, BarChart2, TrendingUp,
  ClipboardList, Home, Trash2, Save,
} from 'lucide-react';

/* ══════════════════════════════════════════════
   STORAGE
══════════════════════════════════════════════ */
const SK_ROWS    = 'myd_rows_v4';
const SK_RESULTS = 'myd_results_v4';
const SK_META    = 'myd_meta_v4';

// purge old keys so they don't waste quota
if (typeof window !== 'undefined') {
  ['myd_rows_v3','myd_results_v3','myd_meta_v3'].forEach(k => localStorage.removeItem(k));
}

const SLIM_COLS = [
  'Grievance ID','Petitioner','Department Name',
  'Sub Department/குறை தொடர்புடைய துணைத்துறை',
  'Responsible Officer/பொறுப்பு அதிகாரி',
  'Petition Details','Reason for Acceptance','Reason for Rejection',
  'Status Display','Taluk/வட்டம்',
  'Grievance Type/குறையின் வகை',
  'Ticket Age in Days','Days of Pending',
] as const;

function slimRow(r: GrievanceRow): GrievanceRow {
  const o: Record<string,unknown> = {};
  SLIM_COLS.forEach(k => { o[k] = r[k] ?? ''; });
  return o as GrievanceRow;
}

/* Trim long Gemini text so results fit in localStorage (5 MB limit) */
function slimResult(r: AuditResult): AuditResult {
  return {
    ...r,
    English_Analysis:        String(r.English_Analysis        || '').slice(0, 220),
    Required_Correction_Tamil: String(r.Required_Correction_Tamil || '').slice(0, 220),
    'Petition Details':      String(r['Petition Details']      || '').slice(0, 120),
  };
}

/* Returns true on success, false if quota exceeded */
function lsSave(k: string, v: unknown): boolean {
  try {
    localStorage.setItem(k, JSON.stringify(v));
    return true;
  } catch {
    return false;
  }
}
function lsLoad<T>(k: string): T | null {
  try { const v = localStorage.getItem(k); return v ? JSON.parse(v) as T : null; } catch { return null; }
}

/* ══════════════════════════════════════════════
   HELPERS
══════════════════════════════════════════════ */
function getReply(r: GrievanceRow) {
  return String(r['Reason for Acceptance'] || r['Reason for Rejection'] || '').trim();
}
function shortDept(d: string) {
  return (d || '').replace(' Department','').replace(' and ',' & ').replace('Administration','Admin').slice(0,30);
}
function shortTaluk(t: string) {
  return (t || '').replace(/\s*\(\d+\)/,'');
}

const STATUS_CLR: Record<string,string> = {
  Accepted:'#22c55e', Rejected:'#ef4444',
  'Pending Action':'#f59e0b', Received:'#6366f1',
  'In Process':'#3b82f6', Pending:'#f97316',
  'Accepted and Waitlisted':'#14b8a6',
};
const GRADE_CLR: Record<string,string> = { A:'#22c55e', C:'#f59e0b', F:'#ef4444' };

type Section = 'upload' | 'overview' | 'audit' | 'insights' | 'export';

/* ══════════════════════════════════════════════
   MAIN COMPONENT
══════════════════════════════════════════════ */
export default function Dashboard() {
  const fileRef = useRef<HTMLInputElement>(null);

  const [rows,       setRows]       = useState<GrievanceRow[]>([]);
  const [results,    setResults]    = useState<AuditResult[]>([]);
  const [processing, setProcessing] = useState(false);
  const [parsing,    setParsing]    = useState(false);
  const [processed,  setProcessed]  = useState(0);
  const [apiKey,     setApiKey]     = useState('');
  const [fileErr,    setFileErr]    = useState('');
  const [fileName,   setFileName]   = useState('');
  const [savedAt,     setSavedAt]     = useState<string|null>(null);
  const [saveErr,     setSaveErr]     = useState(false);
  const [cloudStatus, setCloudStatus] = useState<'idle'|'saving'|'saved'|'error'>('idle');
  const [loading,     setLoading]     = useState(true);   // initial Firestore fetch
  const [section,     setSection]     = useState<Section>('upload');

  /* ── Restore from Firestore on mount (localStorage as fast fallback) ── */
  useEffect(() => {
    async function restore() {
      // 1. Try localStorage first for instant load
      const r  = lsLoad<GrievanceRow[]>(SK_ROWS);
      const rs = lsLoad<AuditResult[]>(SK_RESULTS);
      const m  = lsLoad<{file:string;savedAt:string}>(SK_META);
      if (r?.length)  { setRows(r);  setSection('overview'); }
      if (rs?.length) { setResults(rs); setSection('insights'); }
      if (m) { setFileName(m.file); setSavedAt(m.savedAt); }

      // 2. Then load from Firestore (authoritative source)
      try {
        const { meta, rows: fr, results: frs } = await fsLoad();
        if (fr.length > (r?.length ?? 0)) {
          setRows(fr); lsSave(SK_ROWS, fr);
          setSection(frs.length ? 'insights' : 'overview');
        }
        if (frs.length > (rs?.length ?? 0)) {
          setResults(frs); lsSave(SK_RESULTS, frs.map(slimResult));
          setSection('insights');
        }
        if (meta) {
          setFileName(meta.fileName);
          const ts = new Date(meta.savedAt).toLocaleString('en-IN');
          setSavedAt(ts);
          lsSave(SK_META, { file: meta.fileName, savedAt: ts });
        }
      } catch { /* network offline — localStorage data already shown */ }
      finally { setLoading(false); }
    }
    restore();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── Save rows to Firestore + localStorage ── */
  const saveRows = useCallback(async (newRows: GrievanceRow[], fname: string) => {
    // localStorage immediately
    const ok = lsSave(SK_ROWS, newRows);
    setSaveErr(!ok);
    const ts = new Date().toLocaleString('en-IN');
    setSavedAt(ts);
    lsSave(SK_META, { file: fname, savedAt: ts });

    // Firestore in background
    setCloudStatus('saving');
    const cloudOk = await fsSaveRows(newRows, fname);
    setCloudStatus(cloudOk ? 'saved' : 'error');
    if (!cloudOk) setSaveErr(true);
  }, []);

  /* ── Save results to Firestore + localStorage (called once on audit complete) ── */
  const saveResultsNow = useCallback(async (list: AuditResult[], fname: string) => {
    const slim = list.map(slimResult);
    const ok = lsSave(SK_RESULTS, slim);
    setSaveErr(!ok);
    const ts = new Date().toLocaleString('en-IN');
    setSavedAt(ts);
    lsSave(SK_META, { file: fname, savedAt: ts });

    setCloudStatus('saving');
    const cloudOk = await fsSaveResults(list, fname);
    setCloudStatus(cloudOk ? 'saved' : 'error');
    if (!cloudOk) setSaveErr(true);
  }, []);

  /* ── Clear everything ── */
  const clearAll = useCallback(async () => {
    [SK_ROWS, SK_RESULTS, SK_META].forEach(k => localStorage.removeItem(k));
    setRows([]); setResults([]); setFileName(''); setFileErr('');
    setSavedAt(null); setSaveErr(false); setCloudStatus('idle'); setSection('upload');
    await fsClear();
  }, []);

  /* ── Parse file ── */
  const parseFile = useCallback(async (file: File) => {
    setFileErr(''); setRows([]); setResults([]); setFileName(file.name); setParsing(true);
    try {
      const buf = await new Promise<ArrayBuffer>((res, rej) => {
        const fr = new FileReader();
        fr.onload = e => res(e.target?.result as ArrayBuffer);
        fr.onerror = () => rej(new Error('FileReader failed'));
        fr.readAsArrayBuffer(file);
      });
      const XLSX = await import('xlsx');
      const wb = XLSX.read(new Uint8Array(buf), { type:'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const data = XLSX.utils.sheet_to_json<Record<string,unknown>>(ws, { defval:'' });
      if (!data.length) { setFileErr('File is empty.'); return; }
      const cols = Object.keys(data[0]);
      const miss = ['Grievance ID','Petition Details','Department Name','Status Display']
        .filter(c => !cols.includes(c));
      if (miss.length) { setFileErr(`Missing columns: ${miss.join(', ')}`); return; }
      const slim = (data as GrievanceRow[]).map(slimRow);
      setRows(slim); setResults([]); setSection('overview');
      await saveRows(slim, file.name);
    } catch (e) {
      setFileErr(`Error: ${e instanceof Error ? e.message : 'Unknown'}`);
    } finally { setParsing(false); }
  }, [saveRows]);

  /* ── Run audit ── */
  const startAudit = useCallback(async () => {
    if (!rows.length || processing) return;
    setProcessing(true); setResults([]); setProcessed(0); setSaveErr(false);
    const collected: AuditResult[] = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      try {
        const res = await fetch('/api/audit', {
          method:'POST',
          headers:{
            'Content-Type':'application/json',
            ...(apiKey ? {'x-gemini-key': apiKey} : {}),
          },
          body: JSON.stringify({
            petition_id:       row['Grievance ID'],
            department:        row['Department Name'],
            sub_department:    row['Sub Department/குறை தொடர்புடைய துணைத்துறை'],
            responsible_officer: row['Responsible Officer/பொறுப்பு அதிகாரி'],
            grievance_type:    row['Grievance Type/குறையின் வகை'],
            citizen_grievance: row['Petition Details'],
            officer_reply:     getReply(row),
            status:            row['Status Display'],
          }),
        });
        const d = await res.json();
        collected.push({
          ...row, _officer_reply: getReply(row),
          Audit_Grade: d.Grade || 'F',
          Audit_Status: d.Status || 'FAIL',
          English_Analysis: d.Audit_Reason_EN || '',
          Required_Correction_Tamil: d.Fix_Action_TA || '',
        });
      } catch {
        collected.push({
          ...row, _officer_reply: getReply(row),
          Audit_Grade: 'F', Audit_Status: 'FAIL',
          English_Analysis: 'Network error.',
          Required_Correction_Tamil: 'பிழை ஏற்பட்டது.',
        });
      }
      setProcessed(i + 1);
      /* Update UI every 25 rows so table is live, but don't thrash localStorage */
      if ((i + 1) % 25 === 0) setResults([...collected]);
    }

    /* Final state + single localStorage write */
    setResults([...collected]);
    saveResultsNow(collected, fileName);
    setProcessing(false); setSection('insights');
  }, [rows, apiKey, processing, saveResultsNow, fileName]);

  /* ── CSV download ── */
  const downloadCSV = useCallback(() => {
    const cols: (keyof AuditResult)[] = [
      'Grievance ID','Petitioner','Department Name',
      'Responsible Officer/பொறுப்பு அதிகாரி',
      'Taluk/வட்டம்','Grievance Type/குறையின் வகை',
      'Status Display','Ticket Age in Days',
      '_officer_reply','Audit_Grade','Audit_Status',
      'English_Analysis','Required_Correction_Tamil',
    ];
    const csv = '﻿' + [
      cols.join(','),
      ...results.map(r => cols.map(h => `"${String(r[h]??'').replace(/"/g,'""')}"`).join(',')),
    ].join('\n');
    const a = Object.assign(document.createElement('a'), {
      href: URL.createObjectURL(new Blob([csv], {type:'text/csv;charset=utf-8'})),
      download: 'Mayiladuthurai_Audit.csv',
    });
    a.click();
  }, [results]);

  /* ══ PRE-STATS ══ */
  const pre = useMemo((): PreStats | null => {
    if (!rows.length) return null;
    const sd: Record<string,number> = {};
    const dm: Record<string,number> = {};
    const tm: Record<string,number> = {};
    const ty: Record<string,number> = {};
    rows.forEach(r => {
      const s = String(r['Status Display']||'?'); sd[s]=(sd[s]||0)+1;
      const d = String(r['Department Name']||'?'); dm[d]=(dm[d]||0)+1;
      const t = String(r['Taluk/வட்டம்']||'?');   tm[t]=(tm[t]||0)+1;
      const y = String(r['Grievance Type/குறையின் வகை']||'?'); ty[y]=(ty[y]||0)+1;
    });
    const withReply = rows.filter(r => getReply(r).length > 0).length;
    return {
      total: rows.length, withReply, noReply: rows.length - withReply,
      statusDist: sd,
      deptDist:  Object.entries(dm).sort((a,b)=>b[1]-a[1]).slice(0,8),
      talukDist: Object.entries(tm).sort((a,b)=>b[1]-a[1]),
      typeDist:  Object.entries(ty).sort((a,b)=>b[1]-a[1]).slice(0,10),
    };
  }, [rows]);

  /* ══ AUDIT METRICS ══ */
  const metrics = useMemo(() => {
    if (!results.length) return null;
    const total   = results.length;
    const passed  = results.filter(r => r.Audit_Status === 'PASS').length;
    const failed  = total - passed;
    const passRate = Math.round((passed / total) * 100);

    const gradeData = ['A','C','F'].map(g => ({
      grade: g, count: results.filter(r => r.Audit_Grade === g).length,
    }));

    // Dept pass rate
    const deptMap: Record<string,{pass:number;total:number}> = {};
    results.forEach(r => {
      const d = shortDept(String(r['Department Name']||'?'));
      if (!deptMap[d]) deptMap[d] = {pass:0,total:0};
      deptMap[d].total++;
      if (r.Audit_Status === 'PASS') deptMap[d].pass++;
    });
    const deptRate = Object.entries(deptMap)
      .map(([dept,{pass,total}]) => ({
        dept, pass, fail: total-pass, total,
        rate: Math.round((pass/total)*100),
      }))
      .sort((a,b) => a.rate - b.rate);

    // Taluk pass/fail
    const talukMap: Record<string,{pass:number;fail:number}> = {};
    results.forEach(r => {
      const t = shortTaluk(String(r['Taluk/வட்டம்']||'?'));
      if (!talukMap[t]) talukMap[t] = {pass:0,fail:0};
      if (r.Audit_Status === 'PASS') talukMap[t].pass++;
      else talukMap[t].fail++;
    });
    const talukPerf = Object.entries(talukMap)
      .map(([taluk,{pass,fail}]) => ({taluk, pass, fail}))
      .sort((a,b) => (b.pass+b.fail)-(a.pass+a.fail));

    // Ticket age buckets (failed only)
    const ageBuckets: Record<string,number> = {'0-7':0,'8-15':0,'16-30':0,'31-60':0,'60+':0};
    results.filter(r=>r.Audit_Status==='FAIL').forEach(r => {
      const age = Number(r['Ticket Age in Days'] || 0);
      if (age<=7) ageBuckets['0-7']++;
      else if (age<=15) ageBuckets['8-15']++;
      else if (age<=30) ageBuckets['16-30']++;
      else if (age<=60) ageBuckets['31-60']++;
      else ageBuckets['60+']++;
    });
    const ageData = Object.entries(ageBuckets).map(([bucket,count]) => ({bucket, count}));

    // Grievance type F rate
    const typeMap: Record<string,{f:number;total:number}> = {};
    results.forEach(r => {
      const t = String(r['Grievance Type/குறையின் வகை']||'?').slice(0,32);
      if (!typeMap[t]) typeMap[t] = {f:0,total:0};
      typeMap[t].total++;
      if (r.Audit_Grade==='F') typeMap[t].f++;
    });
    const typeRate = Object.entries(typeMap)
      .filter(([,{total}]) => total >= 5)
      .map(([type,{f,total}]) => ({type, fRate: Math.round((f/total)*100), total}))
      .sort((a,b) => b.fRate - a.fRate).slice(0,10);

    // Officer failures
    const officerMap: Record<string,{fail:number;total:number}> = {};
    results.forEach(r => {
      const o = String(r['Responsible Officer/பொறுப்பு அதிகாரி']||'Unknown').slice(0,28);
      if (!officerMap[o]) officerMap[o] = {fail:0,total:0};
      officerMap[o].total++;
      if (r.Audit_Status==='FAIL') officerMap[o].fail++;
    });
    const officerFail = Object.entries(officerMap)
      .filter(([,{total}]) => total >= 3)
      .map(([officer,{fail,total}]) => ({
        officer, fail, total,
        rate: Math.round((fail/total)*100),
      }))
      .sort((a,b) => b.fail - a.fail).slice(0,10);

    // Status → Grade cross
    const sgMap: Record<string,Record<string,number>> = {};
    results.forEach(r => {
      const s = String(r['Status Display']||'?');
      const g = String(r.Audit_Grade);
      if (!sgMap[s]) sgMap[s] = {A:0,C:0,F:0};
      sgMap[s][g] = (sgMap[s][g]||0)+1;
    });
    const sgData = Object.entries(sgMap).map(([status,grades]) => ({status,...grades}));

    return { total, passed, failed, passRate, gradeData, deptRate, talukPerf, ageData, typeRate, officerFail, sgData };
  }, [results]);

  const progressPct = rows.length > 0 ? Math.round((processed / rows.length) * 100) : 0;

  /* ══════════════════════════════════════════════
     NAV CONFIG
  ══════════════════════════════════════════════ */
  const navItems: { id: Section; icon: React.ReactNode; label: string; badge?: number; disabled?: boolean }[] = [
    { id:'upload',   icon:<Upload size={16}/>,        label:'Upload Data' },
    { id:'overview', icon:<Home size={16}/>,          label:'Overview',  badge:rows.length||undefined, disabled:!rows.length },
    { id:'audit',    icon:<ClipboardList size={16}/>, label:'Run Audit', badge:results.length||undefined, disabled:!rows.length },
    { id:'insights', icon:<TrendingUp size={16}/>,    label:'Insights',  disabled:!results.length },
    { id:'export',   icon:<Download size={16}/>,      label:'Export',    disabled:!rows.length },
  ];

  /* ══════════════════════════════════════════════
     RENDER
  ══════════════════════════════════════════════ */
  /* ── Initial loading screen while Firestore fetches ── */
  if (loading) return (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center gap-4">
      <div className="w-10 h-10 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin"/>
      <p className="text-sm text-slate-500">Loading saved data from Firebase…</p>
    </div>
  );

  return (
    <div className="flex min-h-screen bg-slate-50">

      {/* ═══ SIDEBAR ═══ */}
      <aside className="w-56 min-h-screen bg-white border-r border-slate-200 flex flex-col fixed top-0 left-0 z-30 shadow-sm">
        {/* Logo */}
        <div className="px-5 py-5 border-b border-slate-100">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center shrink-0">
              <Shield size={16} className="text-white"/>
            </div>
            <div>
              <p className="font-bold text-slate-800 text-sm leading-tight">MYD Audit</p>
              <p className="text-xs text-slate-400 leading-tight">Collectorate</p>
            </div>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 py-4 space-y-0.5">
          {navItems.map(item => (
            <button key={item.id}
              onClick={() => !item.disabled && setSection(item.id)}
              disabled={item.disabled}
              className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-sm transition-colors ${
                section === item.id
                  ? 'bg-indigo-600 text-white font-semibold'
                  : item.disabled
                  ? 'text-slate-300 cursor-not-allowed'
                  : 'text-slate-600 hover:bg-slate-100 hover:text-slate-800'
              }`}>
              <div className="flex items-center gap-2.5">{item.icon}<span>{item.label}</span></div>
              {item.badge ? (
                <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${
                  section===item.id ? 'bg-indigo-500 text-white' : 'bg-slate-100 text-slate-600'
                }`}>{item.badge.toLocaleString()}</span>
              ) : null}
            </button>
          ))}
        </nav>

        {/* Footer */}
        <div className="px-4 py-4 border-t border-slate-100 space-y-2">
          {/* Cloud sync status */}
          {cloudStatus === 'saving' && (
            <div className="flex items-center gap-1.5 text-xs text-indigo-600">
              <Loader2 size={11} className="animate-spin"/> Syncing to Firebase…
            </div>
          )}
          {cloudStatus === 'saved' && !saveErr && (
            <div className="flex items-center gap-1.5 text-xs text-emerald-600">
              <CheckCircle2 size={11}/> Firebase saved
            </div>
          )}
          {cloudStatus === 'error' || saveErr ? (
            <div className="flex items-start gap-1.5 text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-2.5 py-2 leading-tight">
              <AlertCircle size={11} className="mt-0.5 shrink-0"/>
              <span>Cloud save failed. Export CSV as backup.</span>
            </div>
          ) : null}
          {savedAt && cloudStatus !== 'saving' && (
            <div className="flex items-center gap-1.5 text-xs text-slate-400">
              <Save size={10}/> {savedAt}
            </div>
          )}
          {rows.length > 0 && (
            <button onClick={clearAll}
              className="w-full flex items-center gap-2 text-xs text-red-500 hover:text-red-700 hover:bg-red-50 px-2 py-1.5 rounded-lg transition-colors">
              <Trash2 size={12}/> Clear All Data
            </button>
          )}
        </div>
      </aside>

      {/* ═══ MAIN ═══ */}
      <div className="ml-56 flex-1 flex flex-col min-h-screen">

        {/* Top bar */}
        <header className="bg-white border-b border-slate-200 px-6 py-3 flex items-center justify-between sticky top-0 z-20">
          <div>
            <h1 className="font-bold text-slate-800 text-sm capitalize">
              {navItems.find(n=>n.id===section)?.label || 'Dashboard'}
            </h1>
            {fileName && <p className="text-xs text-slate-400">{fileName}</p>}
          </div>
          <div className="flex items-center gap-3">
            {processing && (
              <span className="flex items-center gap-1.5 text-xs text-indigo-600 bg-indigo-50 px-3 py-1.5 rounded-full">
                <Loader2 size={12} className="animate-spin"/>
                {processed.toLocaleString()} / {rows.length.toLocaleString()} audited
              </span>
            )}
            <span className="inline-flex items-center gap-1 bg-emerald-50 text-emerald-700 text-xs font-medium px-2.5 py-1 rounded-full border border-emerald-200">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"/> Live
            </span>
          </div>
        </header>

        <main className="flex-1 px-6 py-6 space-y-6">

          {/* ══════ UPLOAD ══════ */}
          {section === 'upload' && (
            <div className="max-w-2xl mx-auto space-y-5">
              <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-8">
                <h2 className="font-semibold text-slate-800 mb-1">Upload CM Helpline Export</h2>
                <p className="text-sm text-slate-500 mb-6">Upload the Excel file downloaded from the Monday GDP portal.</p>

                <div
                  className={`border-2 border-dashed rounded-xl p-10 text-center transition-all ${
                    parsing ? 'border-indigo-300 bg-indigo-50/30 cursor-wait'
                            : 'border-slate-200 cursor-pointer hover:border-indigo-400 hover:bg-indigo-50/20'
                  }`}
                  onClick={() => !parsing && fileRef.current?.click()}
                  onDrop={e => { e.preventDefault(); if (!parsing) e.dataTransfer.files[0] && parseFile(e.dataTransfer.files[0]); }}
                  onDragOver={e => e.preventDefault()}
                >
                  {parsing ? (
                    <><Loader2 className="mx-auto text-indigo-500 mb-3 animate-spin" size={40}/>
                      <p className="text-indigo-600 font-medium">Reading Excel file…</p>
                      <p className="text-slate-400 text-sm mt-1">{fileName}</p></>
                  ) : (
                    <><FileSpreadsheet className="mx-auto text-slate-300 mb-3" size={44}/>
                      <p className="text-slate-600 font-semibold">Drop your .xlsx file here</p>
                      <p className="text-slate-400 text-sm mt-1">or click to browse</p></>
                  )}
                  <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden"
                    onChange={e => e.target.files?.[0] && parseFile(e.target.files[0])}/>
                </div>

                {fileErr && (
                  <div className="mt-4 flex items-start gap-2 text-sm text-red-700 bg-red-50 px-4 py-3 rounded-lg">
                    <AlertCircle size={15} className="mt-0.5 shrink-0"/>{fileErr}
                  </div>
                )}
              </div>

              {/* Required columns hint */}
              <div className="bg-indigo-50 border border-indigo-100 rounded-2xl p-5">
                <p className="text-sm font-semibold text-indigo-800 mb-3">Required columns in your Excel:</p>
                <div className="flex flex-wrap gap-2">
                  {['Grievance ID','Petitioner','Petition Details','Reason for Acceptance','Reason for Rejection',
                    'Department Name','Status Display','Taluk/வட்டம்','Grievance Type/குறையின் வகை','Ticket Age in Days']
                    .map(c => (
                      <span key={c} className="bg-white border border-indigo-200 text-indigo-700 text-xs px-2.5 py-1 rounded-full font-medium">{c}</span>
                    ))}
                </div>
              </div>
            </div>
          )}

          {/* ══════ OVERVIEW ══════ */}
          {section === 'overview' && pre && (
            <div className="space-y-5">
              {/* Summary cards */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                {[
                  { label:'Total Grievances',  value:pre.total,                             icon:<FileSpreadsheet size={18}/>, color:'indigo' },
                  { label:'Accepted',          value:pre.statusDist['Accepted']||0,         icon:<CheckCircle2 size={18}/>,    color:'green'  },
                  { label:'Pending / Received',value:(pre.statusDist['Pending Action']||0)+(pre.statusDist['Received']||0), icon:<Clock size={18}/>, color:'amber' },
                  { label:'Rejected',          value:pre.statusDist['Rejected']||0,         icon:<XCircle size={18}/>,         color:'red'    },
                ].map(({label,value,icon,color}) => (
                  <div key={label} className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
                    <div className={`w-9 h-9 rounded-xl flex items-center justify-center mb-3 ${
                      color==='indigo'?'bg-indigo-100 text-indigo-600':
                      color==='green' ?'bg-emerald-100 text-emerald-600':
                      color==='amber' ?'bg-amber-100 text-amber-600':'bg-red-100 text-red-600'
                    }`}>{icon}</div>
                    <p className="text-2xl font-bold text-slate-800">{value.toLocaleString()}</p>
                    <p className="text-xs text-slate-500 mt-1">{label}</p>
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
                  <p className="text-sm font-semibold text-slate-700 mb-1">With Officer Reply</p>
                  <p className="text-3xl font-bold text-indigo-600">{pre.withReply.toLocaleString()}</p>
                  <p className="text-xs text-slate-400 mt-1">will be graded by AI</p>
                </div>
                <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
                  <p className="text-sm font-semibold text-slate-700 mb-1">No Reply (auto-F)</p>
                  <p className="text-3xl font-bold text-amber-500">{pre.noReply.toLocaleString()}</p>
                  <p className="text-xs text-slate-400 mt-1">no API call needed</p>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                <ChartCard title="Status Distribution">
                  <BarChart data={Object.entries(pre.statusDist).map(([s,c])=>({status:s.replace(' Action',''),count:c}))} barSize={36}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9"/>
                    <XAxis dataKey="status" tick={{fontSize:10}}/>
                    <YAxis allowDecimals={false} tick={{fontSize:11}}/>
                    <Tooltip/>
                    <Bar dataKey="count" radius={[5,5,0,0]}>
                      {Object.entries(pre.statusDist).map(([s])=><Cell key={s} fill={STATUS_CLR[s]||'#94a3b8'}/>)}
                    </Bar>
                  </BarChart>
                </ChartCard>

                <ChartCard title="Grievances by Taluk">
                  <BarChart data={pre.talukDist.map(([t,c])=>({taluk:shortTaluk(t),count:c}))} layout="vertical" barSize={20}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9"/>
                    <XAxis type="number" allowDecimals={false} tick={{fontSize:11}}/>
                    <YAxis type="category" dataKey="taluk" width={120} tick={{fontSize:11}}/>
                    <Tooltip/>
                    <Bar dataKey="count" fill="#6366f1" radius={[0,5,5,0]}/>
                  </BarChart>
                </ChartCard>

                <ChartCard title="Top Departments">
                  <BarChart data={pre.deptDist.map(([d,c])=>({dept:shortDept(d),count:c}))} layout="vertical" barSize={18}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9"/>
                    <XAxis type="number" allowDecimals={false} tick={{fontSize:11}}/>
                    <YAxis type="category" dataKey="dept" width={165} tick={{fontSize:10}}/>
                    <Tooltip/>
                    <Bar dataKey="count" fill="#8b5cf6" radius={[0,5,5,0]}/>
                  </BarChart>
                </ChartCard>

                <ChartCard title="Top Grievance Types">
                  <BarChart data={pre.typeDist.map(([t,c])=>({type:t.slice(0,28),count:c}))} layout="vertical" barSize={18}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9"/>
                    <XAxis type="number" allowDecimals={false} tick={{fontSize:11}}/>
                    <YAxis type="category" dataKey="type" width={165} tick={{fontSize:10}}/>
                    <Tooltip/>
                    <Bar dataKey="count" fill="#0ea5e9" radius={[0,5,5,0]}/>
                  </BarChart>
                </ChartCard>
              </div>
            </div>
          )}

          {/* ══════ AUDIT ══════ */}
          {section === 'audit' && (
            <div className="space-y-5 max-w-5xl">
              {/* API key + start */}
              <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 flex flex-col sm:flex-row gap-4 items-end">
                <div className="flex-1">
                  <label className="block text-sm font-semibold text-slate-700 mb-1.5">Gemini API Key (optional)</label>
                  <input type="password" value={apiKey} onChange={e=>setApiKey(e.target.value)}
                    placeholder="AIza... — leave blank for offline simulation"
                    className="w-full border border-slate-300 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"/>
                  <p className="text-xs text-slate-400 mt-1">Free key at <a href="https://aistudio.google.com" target="_blank" rel="noreferrer" className="text-indigo-500 hover:underline">aistudio.google.com</a></p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {apiKey
                    ? <span className="text-xs text-emerald-600 bg-emerald-50 border border-emerald-200 px-3 py-1.5 rounded-full">🤖 Live Gemini</span>
                    : <span className="text-xs text-amber-600 bg-amber-50 border border-amber-200 px-3 py-1.5 rounded-full">⚡ Simulation</span>}
                  <button onClick={startAudit} disabled={processing}
                    className="flex items-center gap-2 bg-indigo-600 text-white rounded-xl px-6 py-2.5 font-semibold text-sm hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
                    <Play size={14}/>
                    {processing ? 'Auditing…' : `Start Audit (${rows.length.toLocaleString()})`}
                  </button>
                </div>
              </div>

              {/* Progress */}
              {processing && (
                <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
                  <div className="flex justify-between text-xs text-slate-500 mb-2">
                    <span>Processing {processed.toLocaleString()} of {rows.length.toLocaleString()} petitions…</span>
                    <span className="font-bold text-indigo-600">{progressPct}%</span>
                  </div>
                  <div className="h-2.5 bg-slate-100 rounded-full overflow-hidden">
                    <div className="h-full bg-indigo-600 rounded-full transition-all duration-300" style={{width:`${progressPct}%`}}/>
                  </div>
                </div>
              )}

              {/* Results table */}
              {results.length > 0 && (
                <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="font-semibold text-slate-800 text-sm">Audit Results — {results.length.toLocaleString()} rows</h3>
                    <button onClick={downloadCSV}
                      className="flex items-center gap-2 bg-slate-900 text-white rounded-lg px-4 py-2 text-xs font-semibold hover:bg-slate-700 transition-colors">
                      <Download size={13}/> Download CSV
                    </button>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="bg-slate-50 text-slate-500 uppercase text-left tracking-wide">
                          {['ID','Petitioner','Department','Taluk','Type','Status','Age','Grade','Result','Analysis','Correction'].map(h=>(
                            <th key={h} className="px-3 py-3 font-semibold whitespace-nowrap">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {results.map((r,i)=>(
                          <tr key={i} className="hover:bg-slate-50">
                            <td className="px-3 py-2.5 font-mono text-slate-500">{String(r['Grievance ID']).slice(-10)}</td>
                            <td className="px-3 py-2.5 text-slate-700">{String(r['Petitioner']||'').slice(0,16)}</td>
                            <td className="px-3 py-2.5 text-slate-600">{shortDept(String(r['Department Name']||'')).slice(0,20)}</td>
                            <td className="px-3 py-2.5 text-slate-500 whitespace-nowrap">{shortTaluk(String(r['Taluk/வட்டம்']||''))}</td>
                            <td className="px-3 py-2.5 text-slate-500 max-w-[100px] truncate">{String(r['Grievance Type/குறையின் வகை']||'')}</td>
                            <td className="px-3 py-2.5 whitespace-nowrap">
                              <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                                r['Status Display']==='Accepted'?'bg-emerald-100 text-emerald-700':
                                r['Status Display']==='Rejected'?'bg-red-100 text-red-700':'bg-amber-100 text-amber-700'
                              }`}>{String(r['Status Display'])}</span>
                            </td>
                            <td className="px-3 py-2.5 text-center text-slate-500">{r['Ticket Age in Days']??'—'}</td>
                            <td className="px-3 py-2.5">
                              <span className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-white font-bold text-xs ${
                                r.Audit_Grade==='A'?'bg-emerald-500':r.Audit_Grade==='C'?'bg-amber-500':'bg-red-500'
                              }`}>{r.Audit_Grade}</span>
                            </td>
                            <td className="px-3 py-2.5">
                              <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${
                                r.Audit_Status==='PASS'?'bg-emerald-100 text-emerald-700':'bg-red-100 text-red-700'
                              }`}>{r.Audit_Status}</span>
                            </td>
                            <td className="px-3 py-2.5 text-slate-600 max-w-[180px]">
                              <span className="line-clamp-2" title={r.English_Analysis}>{r.English_Analysis}</span>
                            </td>
                            <td className="px-3 py-2.5 text-slate-500 max-w-[180px]">
                              <span className="line-clamp-2" title={r.Required_Correction_Tamil}>{r.Required_Correction_Tamil}</span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ══════ INSIGHTS ══════ */}
          {section === 'insights' && metrics && (
            <div className="space-y-5">

              {/* KPI cards */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                {[
                  { label:'Overall Pass Rate',     value:`${metrics.passRate}%`,  sub:`${metrics.passed} passed`, color:'indigo' },
                  { label:'Grade A Responses',     value:metrics.gradeData.find(g=>g.grade==='A')?.count||0, sub:'genuine resolutions', color:'green' },
                  { label:'Grade F Responses',     value:metrics.gradeData.find(g=>g.grade==='F')?.count||0, sub:'need immediate action', color:'red' },
                  { label:'Grade C (Vague)',        value:metrics.gradeData.find(g=>g.grade==='C')?.count||0, sub:'partial replies', color:'amber' },
                ].map(({label,value,sub,color})=>(
                  <div key={label} className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
                    <p className="text-xs text-slate-500 mb-1">{label}</p>
                    <p className={`text-3xl font-bold ${
                      color==='indigo'?'text-indigo-600':color==='green'?'text-emerald-600':
                      color==='red'?'text-red-500':'text-amber-500'
                    }`}>{typeof value==='number'?value.toLocaleString():value}</p>
                    <p className="text-xs text-slate-400 mt-1">{sub}</p>
                  </div>
                ))}
              </div>

              {/* Grade + Status-Grade cross */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                <ChartCard title="Grade Distribution">
                  <BarChart data={metrics.gradeData} barSize={64}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9"/>
                    <XAxis dataKey="grade" tick={{fontWeight:700,fontSize:14}}/>
                    <YAxis allowDecimals={false} tick={{fontSize:11}}/>
                    <Tooltip/>
                    <Bar dataKey="count" radius={[6,6,0,0]}>
                      {metrics.gradeData.map(e=><Cell key={e.grade} fill={GRADE_CLR[e.grade]}/>)}
                      <LabelList dataKey="count" position="top" style={{fontSize:12,fontWeight:700}}/>
                    </Bar>
                  </BarChart>
                </ChartCard>

                <ChartCard title="Status vs Audit Grade (Stacked)">
                  <BarChart data={metrics.sgData} barSize={40}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9"/>
                    <XAxis dataKey="status" tick={{fontSize:9}}/>
                    <YAxis allowDecimals={false} tick={{fontSize:11}}/>
                    <Tooltip/>
                    <Legend wrapperStyle={{fontSize:11}}/>
                    <Bar dataKey="A" stackId="a" fill="#22c55e" name="Grade A"/>
                    <Bar dataKey="C" stackId="a" fill="#f59e0b" name="Grade C"/>
                    <Bar dataKey="F" stackId="a" fill="#ef4444" name="Grade F" radius={[4,4,0,0]}/>
                  </BarChart>
                </ChartCard>
              </div>

              {/* Department pass rate */}
              <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
                <h3 className="font-semibold text-slate-800 text-sm mb-4">Department Pass Rate (sorted worst → best)</h3>
                <ResponsiveContainer width="100%" height={Math.max(200, metrics.deptRate.length * 36)}>
                  <BarChart data={metrics.deptRate} layout="vertical" barSize={20}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9"/>
                    <XAxis type="number" domain={[0,100]} tickFormatter={v=>`${v}%`} tick={{fontSize:11}}/>
                    <YAxis type="category" dataKey="dept" width={165} tick={{fontSize:10}}/>
                    <Tooltip formatter={(v:number)=>`${v}%`}/>
                    <Bar dataKey="rate" radius={[0,5,5,0]}>
                      {metrics.deptRate.map(e=>(
                        <Cell key={e.dept} fill={e.rate>=70?'#22c55e':e.rate>=40?'#f59e0b':'#ef4444'}/>
                      ))}
                      <LabelList dataKey="rate" position="right" formatter={(v:number)=>`${v}%`} style={{fontSize:10,fontWeight:600}}/>
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>

              {/* Taluk performance + Age distribution */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                <ChartCard title="Taluk Performance (Pass vs Fail)">
                  <BarChart data={metrics.talukPerf} barSize={30}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9"/>
                    <XAxis dataKey="taluk" tick={{fontSize:10}}/>
                    <YAxis allowDecimals={false} tick={{fontSize:11}}/>
                    <Tooltip/>
                    <Legend wrapperStyle={{fontSize:11}}/>
                    <Bar dataKey="pass" stackId="a" fill="#22c55e" name="Pass" radius={[0,0,0,0]}/>
                    <Bar dataKey="fail" stackId="a" fill="#ef4444" name="Fail" radius={[4,4,0,0]}/>
                  </BarChart>
                </ChartCard>

                <ChartCard title="Failed Petitions by Ticket Age">
                  <BarChart data={metrics.ageData} barSize={44}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9"/>
                    <XAxis dataKey="bucket" tick={{fontSize:11}}/>
                    <YAxis allowDecimals={false} tick={{fontSize:11}}/>
                    <Tooltip/>
                    <Bar dataKey="count" fill="#6366f1" radius={[6,6,0,0]}>
                      <LabelList dataKey="count" position="top" style={{fontSize:11,fontWeight:600}}/>
                    </Bar>
                  </BarChart>
                </ChartCard>
              </div>

              {/* Grievance type F rate */}
              <ChartCard title="Grievance Types with Highest Failure Rate (min 5 petitions)" height={320}>
                <BarChart data={metrics.typeRate} layout="vertical" barSize={18}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9"/>
                  <XAxis type="number" domain={[0,100]} tickFormatter={v=>`${v}%`} tick={{fontSize:11}}/>
                  <YAxis type="category" dataKey="type" width={200} tick={{fontSize:10}}/>
                  <Tooltip formatter={(v:number)=>`${v}%`}/>
                  <Bar dataKey="fRate" radius={[0,5,5,0]}>
                    {metrics.typeRate.map(e=><Cell key={e.type} fill={e.fRate>=70?'#ef4444':e.fRate>=40?'#f59e0b':'#22c55e'}/>)}
                    <LabelList dataKey="fRate" position="right" formatter={(v:number)=>`${v}%`} style={{fontSize:10,fontWeight:600}}/>
                  </Bar>
                </BarChart>
              </ChartCard>

              {/* Officer accountability table */}
              <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
                <h3 className="font-semibold text-slate-800 text-sm mb-4">Officer Accountability — Top Failures</h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wide">
                        {['#','Responsible Officer','Total','Passed','Failed','Fail Rate'].map(h=>(
                          <th key={h} className="px-4 py-3 text-left font-semibold">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {metrics.officerFail.map((o,i)=>(
                        <tr key={i} className="hover:bg-slate-50">
                          <td className="px-4 py-2.5 text-slate-400 text-xs">{i+1}</td>
                          <td className="px-4 py-2.5 font-medium text-slate-700">{o.officer}</td>
                          <td className="px-4 py-2.5 text-slate-600">{o.total}</td>
                          <td className="px-4 py-2.5 text-emerald-600 font-semibold">{o.total - o.fail}</td>
                          <td className="px-4 py-2.5 text-red-600 font-semibold">{o.fail}</td>
                          <td className="px-4 py-2.5">
                            <div className="flex items-center gap-2">
                              <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden max-w-[80px]">
                                <div className={`h-full rounded-full ${o.rate>=70?'bg-red-500':o.rate>=40?'bg-amber-500':'bg-emerald-500'}`}
                                  style={{width:`${o.rate}%`}}/>
                              </div>
                              <span className={`text-xs font-bold ${o.rate>=70?'text-red-600':o.rate>=40?'text-amber-600':'text-emerald-600'}`}>
                                {o.rate}%
                              </span>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* ══════ EXPORT ══════ */}
          {section === 'export' && (
            <div className="max-w-xl space-y-4">
              <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-4">
                <h2 className="font-semibold text-slate-800">Export Options</h2>

                <div className="space-y-3">
                  {results.length > 0 && (
                    <button onClick={downloadCSV}
                      className="w-full flex items-center gap-3 p-4 border border-slate-200 rounded-xl hover:border-indigo-300 hover:bg-indigo-50/30 transition-colors text-left">
                      <div className="w-10 h-10 bg-indigo-100 rounded-xl flex items-center justify-center shrink-0">
                        <Download size={18} className="text-indigo-600"/>
                      </div>
                      <div>
                        <p className="font-semibold text-slate-800 text-sm">Audit Results (.CSV)</p>
                        <p className="text-xs text-slate-500">{results.length.toLocaleString()} rows · includes grades, analysis &amp; Tamil corrections</p>
                      </div>
                    </button>
                  )}

                  <button
                    onClick={() => {
                      if (!rows.length) return;
                      const cols = SLIM_COLS as unknown as string[];
                      const csv = '﻿' + [cols.join(','), ...rows.map(r=>cols.map(h=>`"${String(r[h]??'').replace(/"/g,'""')}"`).join(','))].join('\n');
                      const a = Object.assign(document.createElement('a'),{href:URL.createObjectURL(new Blob([csv],{type:'text/csv'})),download:'Grievances_Raw.csv'});
                      a.click();
                    }}
                    className="w-full flex items-center gap-3 p-4 border border-slate-200 rounded-xl hover:border-indigo-300 hover:bg-indigo-50/30 transition-colors text-left">
                    <div className="w-10 h-10 bg-slate-100 rounded-xl flex items-center justify-center shrink-0">
                      <FileSpreadsheet size={18} className="text-slate-600"/>
                    </div>
                    <div>
                      <p className="font-semibold text-slate-800 text-sm">Raw Grievance Data (.CSV)</p>
                      <p className="text-xs text-slate-500">{rows.length.toLocaleString()} rows · original upload (slim columns)</p>
                    </div>
                  </button>
                </div>
              </div>

              {savedAt && (
                <div className="flex items-center gap-2 text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3">
                  <Save size={14}/> Data last saved locally: <strong>{savedAt}</strong>
                </div>
              )}
            </div>
          )}

        </main>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════
   CHART CARD WRAPPER
══════════════════════════════════════════════ */
function ChartCard({ title, children, height=240 }: { title:string; children:React.ReactNode; height?:number }) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
      <h3 className="font-semibold text-slate-800 text-sm mb-4">{title}</h3>
      <ResponsiveContainer width="100%" height={height}>
        {children as React.ReactElement}
      </ResponsiveContainer>
    </div>
  );
}
