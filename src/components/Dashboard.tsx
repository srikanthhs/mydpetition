'use client';
import React, { useState, useCallback, useRef, useMemo, useEffect } from 'react';
import { GrievanceRow, AuditResult, PreStats } from '@/lib/types';
import { fsSaveRows, fsSaveResults, fsLoad, fsClear, fsSaveGeminiKey, fsLoadGeminiKey } from '@/lib/store';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell, Legend,
  LabelList,
} from 'recharts';
import {
  Upload, Download, Play, Shield, AlertCircle, FileSpreadsheet,
  CheckCircle2, Clock, XCircle, Loader2, TrendingUp,
  ClipboardList, Home, Trash2, Save, ChevronRight, ChevronDown,
  RefreshCw, AlertTriangle, Users, X, Printer,
  MessageCircle,
} from 'lucide-react';

/* ══════════════════════════════════════════════
   STORAGE
══════════════════════════════════════════════ */
const SK_ROWS    = 'myd_rows_v4';
const SK_RESULTS = 'myd_results_v4';
const SK_META    = 'myd_meta_v4';

/* Migrate older keys → v4 (never delete without migrating) */
if (typeof window !== 'undefined') {
  for (const [old, cur] of [
    ['myd_rows_v3', SK_ROWS], ['myd_results_v3', SK_RESULTS], ['myd_meta_v3', SK_META],
    ['myd_rows_v2', SK_ROWS], ['myd_results_v2', SK_RESULTS],
  ] as [string,string][]) {
    const existing = localStorage.getItem(cur);
    const oldData  = localStorage.getItem(old);
    if (!existing && oldData) localStorage.setItem(cur, oldData);   // migrate
    if (oldData) localStorage.removeItem(old);                       // then purge old
  }
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

function slimResult(r: AuditResult): AuditResult {
  return {
    ...r,
    _officer_reply:            String(r._officer_reply            || '').slice(0, 300),
    English_Analysis:          String(r.English_Analysis          || '').slice(0, 220),
    Required_Correction_Tamil: String(r.Required_Correction_Tamil || '').slice(0, 220),
    'Petition Details':        String(r['Petition Details']       || '').slice(0, 120),
  };
}

function lsSave(k: string, v: unknown): boolean {
  try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; }
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

type Section = 'upload' | 'overview' | 'audit' | 'insights' | 'escalation' | 'reports' | 'export';

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
  const [keySaved,   setKeySaved]   = useState(false);
  const [fileErr,    setFileErr]    = useState('');
  const [fileName,   setFileName]   = useState('');
  const [savedAt,    setSavedAt]    = useState<string|null>(null);
  const [saveErr,    setSaveErr]    = useState(false);
  const [cloudStatus,setCloudStatus]= useState<'idle'|'saving'|'saved'|'error'>('idle');
  const [loading,    setLoading]    = useState(true);
  const [section,    setSection]    = useState<Section>('upload');

  // Filter state for audit section
  const [filterText,   setFilterText]   = useState('');
  const [filterGrade,  setFilterGrade]  = useState('All');
  const [filterStatus, setFilterStatus] = useState('All');
  const [filterDept,   setFilterDept]   = useState('All');
  const [filterTaluk,  setFilterTaluk]  = useState('All');

  // Expanded rows in audit table
  const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set());

  // Re-audit spinner per row index
  const [reauditingIdx, setReauditingIdx] = useState<Set<number>>(new Set());

  // Insights department filter
  const [insightsDept, setInsightsDept] = useState('All');

  // Reports modal
  const [reportOfficer, setReportOfficer] = useState<string|null>(null);
  const [reportSearch,  setReportSearch]  = useState('');

  /* ── Restore on mount: localStorage first (instant), then Firestore (authoritative) ── */
  useEffect(() => {
    async function restore() {
      /* Step 1: show localStorage data immediately */
      const r  = lsLoad<GrievanceRow[]>(SK_ROWS);
      const rs = lsLoad<AuditResult[]>(SK_RESULTS);
      const m  = lsLoad<{file:string;savedAt:string}>(SK_META);
      if (r?.length)  { setRows(r);  setSection('overview'); }
      if (rs?.length) { setResults(rs); setSection('insights'); }
      if (m) { setFileName(m.file); setSavedAt(m.savedAt); }

      /* Step 2: sync with Firestore */
      try {
        const { meta, rows: fr, results: frs } = await fsLoad();

        if (fr.length > 0) {
          /* Firestore has data — it is the authoritative source */
          setRows(fr);
          lsSave(SK_ROWS, fr);
          setSection(frs.length > 0 ? 'insights' : 'overview');
        } else if (r?.length) {
          /* Firestore is empty but localStorage has rows →
             push localStorage data up to Firestore automatically (no re-upload needed) */
          setCloudStatus('saving');
          const fname = m?.file || 'grievances.xlsx';
          await fsSaveRows(r, fname);
          if (rs?.length) await fsSaveResults(rs, fname);
        }

        if (frs.length > 0) {
          setResults(frs);
          lsSave(SK_RESULTS, frs.map(slimResult));
          setSection('insights');
        } else if (rs?.length && fr.length === 0) {
          /* results were already pushed above with rows */
        }

        if (meta) {
          setFileName(meta.fileName);
          const ts = new Date(meta.savedAt).toLocaleString('en-IN');
          setSavedAt(ts);
          lsSave(SK_META, { file: meta.fileName, savedAt: ts });
        } else if (m) {
          /* Firestore had no meta but localStorage did — use localStorage meta */
          setFileName(m.file);
          setSavedAt(m.savedAt);
        }

        /* Load saved Gemini key */
        const savedKey = await fsLoadGeminiKey();
        if (savedKey) setApiKey(savedKey);

        setCloudStatus('saved');
      } catch (e) {
        console.error('Firestore restore failed:', e);
        setCloudStatus('error');
      } finally {
        setLoading(false);
      }
    }
    restore();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── Auto-sync: whenever results change after initial load, save to Firestore ── */
  const syncedRef = useRef(false);   // true once initial restore is done
  useEffect(() => {
    if (!syncedRef.current) { syncedRef.current = true; return; } // skip on mount
    if (!results.length || !fileName) return;
    // debounce 3 s so rapid re-audit clicks don't hammer Firestore
    const t = setTimeout(async () => {
      lsSave(SK_RESULTS, results.map(slimResult));
      await fsSaveResults(results, fileName);
      setSavedAt(new Date().toLocaleString('en-IN'));
      setCloudStatus('saved');
    }, 3000);
    return () => clearTimeout(t);
  }, [results, fileName]); // eslint-disable-line react-hooks/exhaustive-deps

  const saveRows = useCallback(async (newRows: GrievanceRow[], fname: string) => {
    const ok = lsSave(SK_ROWS, newRows);
    setSaveErr(!ok);
    const ts = new Date().toLocaleString('en-IN');
    setSavedAt(ts);
    lsSave(SK_META, { file: fname, savedAt: ts });
    setCloudStatus('saving');
    const cloudOk = await fsSaveRows(newRows, fname);
    setCloudStatus(cloudOk ? 'saved' : 'error');
    if (!cloudOk) setSaveErr(true);
  }, []);

  const saveResultsNow = useCallback(async (list: AuditResult[], fname: string): Promise<boolean> => {
    // 1. localStorage first (instant, never fails silently)
    const slim = list.map(slimResult);
    lsSave(SK_RESULTS, slim);
    const ts = new Date().toLocaleString('en-IN');
    setSavedAt(ts);
    lsSave(SK_META, { file: fname, savedAt: ts });

    // 2. Firestore (full data, not slimmed)
    setCloudStatus('saving');
    const cloudOk = await fsSaveResults(list, fname);
    setSaveErr(!cloudOk);
    setCloudStatus(cloudOk ? 'saved' : 'error');
    return cloudOk;
  }, []);

  const clearAll = useCallback(async () => {
    [SK_ROWS, SK_RESULTS, SK_META].forEach(k => localStorage.removeItem(k));
    setRows([]); setResults([]); setFileName(''); setFileErr('');
    setSavedAt(null); setSaveErr(false); setCloudStatus('idle'); setSection('upload');
    await fsClear();
  }, []);

  /* ── Save Gemini key ── */
  const saveKey = useCallback(async () => {
    await fsSaveGeminiKey(apiKey);
    setKeySaved(true);
    setTimeout(() => setKeySaved(false), 3000);
  }, [apiKey]);

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
      if ((i + 1) % 25 === 0) setResults([...collected]);
    }

    setResults([...collected]);

    // Await save so we know it actually completed before leaving audit section
    const saved = await saveResultsNow(collected, fileName);
    if (!saved) {
      // Firestore failed — retry once after 2 s
      await new Promise(r => setTimeout(r, 2000));
      await saveResultsNow(collected, fileName);
    }

    setProcessing(false); setSection('insights');
  }, [rows, apiKey, processing, saveResultsNow, fileName]);

  /* ── Re-audit single row ── */
  const reauditRow = useCallback(async (idx: number) => {
    const row = results[idx];
    if (!row) return;
    setReauditingIdx(prev => new Set(prev).add(idx));
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
          officer_reply:     row._officer_reply,
          status:            row['Status Display'],
        }),
      });
      const d = await res.json();
      const updated: AuditResult = {
        ...row,
        Audit_Grade: d.Grade || 'F',
        Audit_Status: d.Status || 'FAIL',
        English_Analysis: d.Audit_Reason_EN || '',
        Required_Correction_Tamil: d.Fix_Action_TA || '',
      };
      // Build the new list outside the state setter, then save it
      const next = [...results];
      next[idx] = updated;
      setResults(next);
      await saveResultsNow(next, fileName);
    } catch { /* keep old */ }
    finally {
      setReauditingIdx(prev => { const s = new Set(prev); s.delete(idx); return s; });
    }
  }, [results, apiKey, saveResultsNow, fileName]);

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

  /* ══ FILTERED RESULTS ══ */
  const filteredResults = useMemo(() => {
    return results.filter(r => {
      const txt = filterText.toLowerCase();
      if (txt && ![String(r['Grievance ID']),String(r['Petitioner']),String(r['Department Name'])].some(v=>v.toLowerCase().includes(txt))) return false;
      if (filterGrade !== 'All' && r.Audit_Grade !== filterGrade) return false;
      if (filterStatus !== 'All' && String(r['Status Display']) !== filterStatus) return false;
      if (filterDept !== 'All' && String(r['Department Name']) !== filterDept) return false;
      if (filterTaluk !== 'All' && String(r['Taluk/வட்டம்']) !== filterTaluk) return false;
      return true;
    });
  }, [results, filterText, filterGrade, filterStatus, filterDept, filterTaluk]);

  const uniqueDepts  = useMemo(() => Array.from(new Set(results.map(r=>String(r['Department Name']||'')))).sort(), [results]);
  const uniqueTaluks = useMemo(() => Array.from(new Set(results.map(r=>String(r['Taluk/வட்டம்']||'')))).sort(), [results]);
  const uniqueStatuses = useMemo(() => Array.from(new Set(results.map(r=>String(r['Status Display']||'')))).sort(), [results]);

  const clearFilters = useCallback(() => {
    setFilterText(''); setFilterGrade('All'); setFilterStatus('All');
    setFilterDept('All'); setFilterTaluk('All');
  }, []);

  /* ══ ESCALATED ROWS ══ */
  const escalated = useMemo(() =>
    results.filter(r => Number(r['Ticket Age in Days']||0) >= 30 && r.Audit_Grade === 'F'),
    [results]
  );

  /* ══ INSIGHTS FILTERED ══ */
  const insightsResults = useMemo(() =>
    insightsDept === 'All' ? results : results.filter(r => String(r['Department Name']||'') === insightsDept),
    [results, insightsDept]
  );

  /* ══ AUDIT METRICS ══ */
  const metrics = useMemo(() => {
    const src = insightsResults;
    if (!src.length) return null;
    const total   = src.length;
    const passed  = src.filter(r => r.Audit_Status === 'PASS').length;
    const failed  = total - passed;
    const passRate = Math.round((passed / total) * 100);

    const gradeData = ['A','C','F'].map(g => ({
      grade: g, count: src.filter(r => r.Audit_Grade === g).length,
    }));

    const deptMap: Record<string,{pass:number;total:number}> = {};
    src.forEach(r => {
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

    const talukMap: Record<string,{pass:number;fail:number}> = {};
    src.forEach(r => {
      const t = shortTaluk(String(r['Taluk/வட்டம்']||'?'));
      if (!talukMap[t]) talukMap[t] = {pass:0,fail:0};
      if (r.Audit_Status === 'PASS') talukMap[t].pass++;
      else talukMap[t].fail++;
    });
    const talukPerf = Object.entries(talukMap)
      .map(([taluk,{pass,fail}]) => ({taluk, pass, fail}))
      .sort((a,b) => (b.pass+b.fail)-(a.pass+a.fail));

    const ageBuckets: Record<string,number> = {'0-7':0,'8-15':0,'16-30':0,'31-60':0,'60+':0};
    src.filter(r=>r.Audit_Status==='FAIL').forEach(r => {
      const age = Number(r['Ticket Age in Days'] || 0);
      if (age<=7) ageBuckets['0-7']++;
      else if (age<=15) ageBuckets['8-15']++;
      else if (age<=30) ageBuckets['16-30']++;
      else if (age<=60) ageBuckets['31-60']++;
      else ageBuckets['60+']++;
    });
    const ageData = Object.entries(ageBuckets).map(([bucket,count]) => ({bucket, count}));

    const typeMap: Record<string,{f:number;total:number}> = {};
    src.forEach(r => {
      const t = String(r['Grievance Type/குறையின் வகை']||'?').slice(0,32);
      if (!typeMap[t]) typeMap[t] = {f:0,total:0};
      typeMap[t].total++;
      if (r.Audit_Grade==='F') typeMap[t].f++;
    });
    const typeRate = Object.entries(typeMap)
      .filter(([,{total}]) => total >= 5)
      .map(([type,{f,total}]) => ({type, fRate: Math.round((f/total)*100), total}))
      .sort((a,b) => b.fRate - a.fRate).slice(0,10);

    const officerMap: Record<string,{fail:number;total:number}> = {};
    src.forEach(r => {
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

    const sgMap: Record<string,Record<string,number>> = {};
    src.forEach(r => {
      const s = String(r['Status Display']||'?');
      const g = String(r.Audit_Grade);
      if (!sgMap[s]) sgMap[s] = {A:0,C:0,F:0};
      sgMap[s][g] = (sgMap[s][g]||0)+1;
    });
    const sgData = Object.entries(sgMap).map(([status,grades]) => ({status,...grades}));

    // Days pending vs grade (stacked bar by age bucket)
    const ageBucketLabels = ['0-7','8-15','16-30','31-60','60+'];
    const ageGradeData = ageBucketLabels.map(bucket => {
      const [lo, hi] = bucket === '60+' ? [60, Infinity] : bucket.split('-').map(Number);
      const inBucket = src.filter(r => {
        const age = Number(r['Ticket Age in Days']||0);
        return age >= lo && age <= hi;
      });
      return {
        bucket,
        A: inBucket.filter(r=>r.Audit_Grade==='A').length,
        C: inBucket.filter(r=>r.Audit_Grade==='C').length,
        F: inBucket.filter(r=>r.Audit_Grade==='F').length,
      };
    });

    // Top 10 pending officers (most F-grade)
    const topFailOfficers = Object.entries(officerMap)
      .map(([officer,{fail,total}]) => ({officer, fail, total}))
      .sort((a,b)=>b.fail-a.fail).slice(0,10);

    // Accepted vs Rejected pass rates
    const accRej = ['Accepted','Rejected','In Process','Pending Action','Received'].map(status => {
      const subset = src.filter(r=>String(r['Status Display']||'')===status);
      const pass = subset.filter(r=>r.Audit_Status==='PASS').length;
      return { status: status.replace(' Action',''), total: subset.length, pass, passRate: subset.length ? Math.round((pass/subset.length)*100) : 0 };
    }).filter(x=>x.total>0);

    return { total, passed, failed, passRate, gradeData, deptRate, talukPerf, ageData, typeRate, officerFail, sgData, ageGradeData, topFailOfficers, accRej };
  }, [insightsResults]);

  /* ══ OFFICER REPORT DATA ══ */
  const officerReportData = useMemo(() => {
    const map: Record<string,{pass:number;fail:number;A:number;C:number;F:number;cases:AuditResult[]}> = {};
    results.forEach(r => {
      const o = String(r['Responsible Officer/பொறுப்பு அதிகாரி']||'Unknown');
      if (!map[o]) map[o] = {pass:0,fail:0,A:0,C:0,F:0,cases:[]};
      map[o].cases.push(r);
      if (r.Audit_Status==='PASS') map[o].pass++;
      else map[o].fail++;
      if (r.Audit_Grade==='A') map[o].A++;
      else if (r.Audit_Grade==='C') map[o].C++;
      else map[o].F++;
    });
    return Object.entries(map).map(([name,d]) => ({
      name, total: d.pass+d.fail, pass: d.pass, fail: d.fail,
      failRate: Math.round((d.fail/(d.pass+d.fail))*100),
      A: d.A, C: d.C, F: d.F, cases: d.cases,
    })).sort((a,b)=>b.total-a.total);
  }, [results]);

  const progressPct = rows.length > 0 ? Math.round((processed / rows.length) * 100) : 0;

  /* ══ NAV CONFIG ══ */
  const navItems: { id: Section; icon: React.ReactNode; label: string; badge?: number; badgeColor?: string; disabled?: boolean }[] = [
    { id:'upload',     icon:<Upload size={16}/>,        label:'Upload Data' },
    { id:'overview',   icon:<Home size={16}/>,          label:'Overview',    badge:rows.length||undefined,    disabled:!rows.length },
    { id:'audit',      icon:<ClipboardList size={16}/>, label:'Run Audit',   badge:results.length||undefined, disabled:!rows.length },
    { id:'insights',   icon:<TrendingUp size={16}/>,    label:'Insights',    disabled:!results.length },
    { id:'escalation', icon:<AlertTriangle size={16}/>, label:'Escalation',  badge:escalated.length||undefined, badgeColor:'red', disabled:!results.length },
    { id:'reports',    icon:<Users size={16}/>,         label:'Reports',     disabled:!results.length },
    { id:'export',     icon:<Download size={16}/>,      label:'Export',      disabled:!rows.length },
  ];

  /* ── Initial loading screen ── */
  if (loading) return (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center gap-4">
      <div className="w-10 h-10 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin"/>
      <p className="text-sm text-slate-600 font-medium">Restoring your data…</p>
      <p className="text-xs text-slate-400">Checking Firebase for saved grievances &amp; audit results</p>
    </div>
  );

  /* ══ RENDER ══ */
  return (
    <div className="flex min-h-screen bg-slate-50">

      {/* ═══ SIDEBAR ═══ */}
      <aside className="w-56 min-h-screen bg-white border-r border-slate-200 flex flex-col fixed top-0 left-0 z-30 shadow-sm">
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
                  section===item.id
                    ? 'bg-indigo-500 text-white'
                    : item.badgeColor === 'red'
                    ? 'bg-red-100 text-red-700'
                    : 'bg-slate-100 text-slate-600'
                }`}>{item.badge.toLocaleString()}</span>
              ) : null}
            </button>
          ))}
        </nav>

        <div className="px-4 py-4 border-t border-slate-100 space-y-2">
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
          {(cloudStatus === 'error' || saveErr) && (
            <div className="flex items-start gap-1.5 text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-2.5 py-2 leading-tight">
              <AlertCircle size={11} className="mt-0.5 shrink-0"/>
              <span>Firebase not reachable. <a href="https://console.firebase.google.com/project/mydpetition/firestore" target="_blank" rel="noreferrer" className="underline font-semibold">Enable Firestore</a> or export CSV.</span>
            </div>
          )}
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
                  onDragOver={e => e.preventDefault()}>
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
            <div className="space-y-5 max-w-6xl">
              {/* API key + start */}
              <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 flex flex-col sm:flex-row gap-4 items-end">
                <div className="flex-1">
                  <label className="block text-sm font-semibold text-slate-700 mb-1.5">Gemini API Key (optional)</label>
                  <input type="password" value={apiKey} onChange={e=>{ setApiKey(e.target.value); setKeySaved(false); }}
                    placeholder="AIza… — leave blank for offline simulation"
                    className="w-full border border-slate-300 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"/>
                  <p className="text-xs text-slate-400 mt-1">Free key at <a href="https://aistudio.google.com" target="_blank" rel="noreferrer" className="text-indigo-500 hover:underline">aistudio.google.com</a></p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button onClick={saveKey}
                    className="flex items-center gap-1.5 text-xs bg-slate-100 hover:bg-slate-200 text-slate-700 px-3 py-2 rounded-lg transition-colors">
                    <Save size={12}/> Save Key
                  </button>
                  {keySaved && <span className="text-xs text-emerald-600 font-medium">Key saved ✓</span>}
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
                    <span>
                      {progressPct === 100 && cloudStatus === 'saving'
                        ? '✅ Audit complete — saving to Firebase…'
                        : `Processing ${processed.toLocaleString()} of ${rows.length.toLocaleString()} petitions…`}
                    </span>
                    <span className="font-bold text-indigo-600">{progressPct}%</span>
                  </div>
                  <div className="h-2.5 bg-slate-100 rounded-full overflow-hidden">
                    <div className={`h-full rounded-full transition-all duration-300 ${
                      progressPct === 100 && cloudStatus === 'saving' ? 'bg-emerald-500' : 'bg-indigo-600'
                    }`} style={{width:`${progressPct}%`}}/>
                  </div>
                </div>
              )}

              {/* Firebase save status banner */}
              {!processing && results.length > 0 && (
                <div className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium ${
                  cloudStatus === 'saved' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                  : cloudStatus === 'saving' ? 'bg-indigo-50 text-indigo-700 border border-indigo-200'
                  : cloudStatus === 'error' ? 'bg-red-50 text-red-700 border border-red-200'
                  : 'hidden'
                }`}>
                  {cloudStatus === 'saving' && <Loader2 size={14} className="animate-spin"/>}
                  {cloudStatus === 'saved'  && <CheckCircle2 size={14}/>}
                  {cloudStatus === 'error'  && <AlertCircle size={14}/>}
                  {cloudStatus === 'saving' && 'Saving audit results to Firebase…'}
                  {cloudStatus === 'saved'  && `${results.length.toLocaleString()} audit results saved to Firebase ✓`}
                  {cloudStatus === 'error'  && 'Firebase save failed — results are in localStorage. Check Firestore rules.'}
                </div>
              )}

              {/* Results table with filters */}
              {results.length > 0 && (
                <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="font-semibold text-slate-800 text-sm">Audit Results — {results.length.toLocaleString()} rows</h3>
                    <button onClick={downloadCSV}
                      className="flex items-center gap-2 bg-slate-900 text-white rounded-lg px-4 py-2 text-xs font-semibold hover:bg-slate-700 transition-colors">
                      <Download size={13}/> Download CSV
                    </button>
                  </div>

                  {/* Filter bar */}
                  <div className="flex flex-wrap gap-2 mb-4 p-3 bg-slate-50 rounded-xl border border-slate-100">
                    <input
                      type="text" value={filterText} onChange={e=>setFilterText(e.target.value)}
                      placeholder="Search ID, Petitioner, Department…"
                      className="border border-slate-200 rounded-lg px-3 py-1.5 text-xs w-52 focus:outline-none focus:ring-1 focus:ring-indigo-400"/>
                    <select value={filterGrade} onChange={e=>setFilterGrade(e.target.value)}
                      className="border border-slate-200 rounded-lg px-2 py-1.5 text-xs bg-white focus:outline-none">
                      <option>All</option><option value="A">Grade A</option><option value="C">Grade C</option><option value="F">Grade F</option>
                    </select>
                    <select value={filterStatus} onChange={e=>setFilterStatus(e.target.value)}
                      className="border border-slate-200 rounded-lg px-2 py-1.5 text-xs bg-white focus:outline-none">
                      <option>All</option>
                      {uniqueStatuses.map(s=><option key={s} value={s}>{s}</option>)}
                    </select>
                    <select value={filterDept} onChange={e=>setFilterDept(e.target.value)}
                      className="border border-slate-200 rounded-lg px-2 py-1.5 text-xs bg-white focus:outline-none max-w-[160px]">
                      <option>All</option>
                      {uniqueDepts.map(d=><option key={d} value={d}>{shortDept(d)}</option>)}
                    </select>
                    <select value={filterTaluk} onChange={e=>setFilterTaluk(e.target.value)}
                      className="border border-slate-200 rounded-lg px-2 py-1.5 text-xs bg-white focus:outline-none">
                      <option>All</option>
                      {uniqueTaluks.map(t=><option key={t} value={t}>{shortTaluk(t)}</option>)}
                    </select>
                    <button onClick={clearFilters} className="text-xs text-slate-500 hover:text-slate-700 px-2 py-1.5 rounded-lg hover:bg-slate-100 transition-colors flex items-center gap-1">
                      <X size={11}/> Clear
                    </button>
                    <span className="ml-auto text-xs text-slate-400 self-center">
                      Showing {filteredResults.length.toLocaleString()} of {results.length.toLocaleString()}
                    </span>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="bg-slate-50 text-slate-500 uppercase text-left tracking-wide">
                          <th className="px-2 py-3 w-6"></th>
                          {['ID','Petitioner','Department','Taluk','Status','Age','Grade','Result','Analysis'].map(h=>(
                            <th key={h} className="px-3 py-3 font-semibold whitespace-nowrap">{h}</th>
                          ))}
                          <th className="px-2 py-3">Re-audit</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {filteredResults.map((r) => {
                          // find real index in results array
                          const realIdx = results.indexOf(r);
                          const isExpanded = expandedRows.has(realIdx);
                          const isReauditing = reauditingIdx.has(realIdx);
                          return (
                            <React.Fragment key={`frag-${realIdx}`}>
                              <tr className={`hover:bg-slate-50 ${isExpanded ? 'bg-slate-50' : ''}`}>
                                <td className="px-2 py-2.5">
                                  <button onClick={() => {
                                    setExpandedRows(prev => {
                                      const s = new Set(prev);
                                      if (s.has(realIdx)) s.delete(realIdx); else s.add(realIdx);
                                      return s;
                                    });
                                  }} className="text-slate-400 hover:text-indigo-600 transition-colors">
                                    {isExpanded ? <ChevronDown size={14}/> : <ChevronRight size={14}/>}
                                  </button>
                                </td>
                                <td className="px-3 py-2.5 font-mono text-slate-500">{String(r['Grievance ID']).slice(-10)}</td>
                                <td className="px-3 py-2.5 text-slate-700">{String(r['Petitioner']||'').slice(0,16)}</td>
                                <td className="px-3 py-2.5 text-slate-600">{shortDept(String(r['Department Name']||'')).slice(0,20)}</td>
                                <td className="px-3 py-2.5 text-slate-500 whitespace-nowrap">{shortTaluk(String(r['Taluk/வட்டம்']||''))}</td>
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
                                <td className="px-3 py-2.5 text-slate-600 max-w-[200px]">
                                  <span className="line-clamp-2" title={r.English_Analysis}>{r.English_Analysis}</span>
                                </td>
                                <td className="px-2 py-2.5">
                                  <button onClick={() => reauditRow(realIdx)} disabled={isReauditing}
                                    className="text-slate-400 hover:text-indigo-600 transition-colors disabled:opacity-40">
                                    {isReauditing ? <Loader2 size={14} className="animate-spin"/> : <RefreshCw size={14}/>}
                                  </button>
                                </td>
                              </tr>
                              {isExpanded && (
                                <tr key={`expand-${realIdx}`}>
                                  <td colSpan={11} className="px-4 py-0">
                                    <div className="my-3 bg-indigo-50 border border-indigo-100 rounded-xl p-5 space-y-3">
                                      <div className="flex items-center justify-between">
                                        <p className="font-semibold text-indigo-800 text-sm">
                                          {String(r['Grievance ID'])} — {String(r['Petitioner']||'')}
                                        </p>
                                        <span className={`inline-flex items-center justify-center w-7 h-7 rounded-full text-white font-bold text-sm ${
                                          r.Audit_Grade==='A'?'bg-emerald-500':r.Audit_Grade==='C'?'bg-amber-500':'bg-red-500'
                                        }`}>{r.Audit_Grade}</span>
                                      </div>
                                      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                                        <div>
                                          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Petition Details</p>
                                          <p className="text-xs text-slate-700 leading-relaxed whitespace-pre-wrap">{String(r['Petition Details']||'—')}</p>
                                        </div>
                                        <div>
                                          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Officer Reply</p>
                                          <p className="text-xs text-slate-700 leading-relaxed whitespace-pre-wrap">{r._officer_reply || '—'}</p>
                                        </div>
                                        <div>
                                          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">English Analysis</p>
                                          <p className="text-xs text-slate-700 leading-relaxed">{r.English_Analysis || '—'}</p>
                                        </div>
                                        <div>
                                          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Required Correction (Tamil)</p>
                                          <p className="text-xs text-slate-700 leading-relaxed">{r.Required_Correction_Tamil || '—'}</p>
                                        </div>
                                      </div>
                                    </div>
                                  </td>
                                </tr>
                              )}
                            </React.Fragment>
                          );
                        })}
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
              {/* Department filter */}
              <div className="flex items-center gap-3 flex-wrap">
                <select value={insightsDept} onChange={e=>setInsightsDept(e.target.value)}
                  className="border border-slate-200 rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300">
                  <option value="All">All Departments</option>
                  {uniqueDepts.map(d=><option key={d} value={d}>{d}</option>)}
                </select>
                {insightsDept !== 'All' && (
                  <span className="flex items-center gap-1.5 bg-indigo-100 text-indigo-700 text-xs px-3 py-1.5 rounded-full font-medium">
                    Viewing: {shortDept(insightsDept)}
                    <button onClick={()=>setInsightsDept('All')} className="hover:text-indigo-900"><X size={12}/></button>
                  </span>
                )}
              </div>

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
                    <XAxis type="number" domain={[0,100]} tickFormatter={(v: number)=>`${v}%`} tick={{fontSize:11}}/>
                    <YAxis type="category" dataKey="dept" width={165} tick={{fontSize:10}}/>
                    <Tooltip formatter={(v: number)=>`${v}%`}/>
                    <Bar dataKey="rate" radius={[0,5,5,0]}>
                      {metrics.deptRate.map(e=>(
                        <Cell key={e.dept} fill={e.rate>=70?'#22c55e':e.rate>=40?'#f59e0b':'#ef4444'}/>
                      ))}
                      <LabelList dataKey="rate" position="right" formatter={(v: number)=>`${v}%`} style={{fontSize:10,fontWeight:600}}/>
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>

              {/* Taluk + Age */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                <ChartCard title="Taluk Performance (Pass vs Fail)">
                  <BarChart data={metrics.talukPerf} barSize={30}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9"/>
                    <XAxis dataKey="taluk" tick={{fontSize:10}}/>
                    <YAxis allowDecimals={false} tick={{fontSize:11}}/>
                    <Tooltip/>
                    <Legend wrapperStyle={{fontSize:11}}/>
                    <Bar dataKey="pass" stackId="a" fill="#22c55e" name="Pass"/>
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

              {/* NEW: Days Pending vs Grade */}
              <ChartCard title="Days Pending vs Grade (Stacked by Age Bucket)" height={260}>
                <BarChart data={metrics.ageGradeData} barSize={44}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9"/>
                  <XAxis dataKey="bucket" tick={{fontSize:11}}/>
                  <YAxis allowDecimals={false} tick={{fontSize:11}}/>
                  <Tooltip/>
                  <Legend wrapperStyle={{fontSize:11}}/>
                  <Bar dataKey="A" stackId="g" fill="#22c55e" name="Grade A"/>
                  <Bar dataKey="C" stackId="g" fill="#f59e0b" name="Grade C"/>
                  <Bar dataKey="F" stackId="g" fill="#ef4444" name="Grade F" radius={[4,4,0,0]}/>
                </BarChart>
              </ChartCard>

              {/* NEW: Top 10 Pending Officers (F-grade) */}
              <ChartCard title="Top 10 Officers with Most Grade F Cases" height={280}>
                <BarChart data={metrics.topFailOfficers} layout="vertical" barSize={20}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9"/>
                  <XAxis type="number" allowDecimals={false} tick={{fontSize:11}}/>
                  <YAxis type="category" dataKey="officer" width={175} tick={{fontSize:10}}/>
                  <Tooltip/>
                  <Bar dataKey="fail" fill="#ef4444" name="Grade F Cases" radius={[0,5,5,0]}>
                    <LabelList dataKey="fail" position="right" style={{fontSize:10,fontWeight:600}}/>
                  </Bar>
                </BarChart>
              </ChartCard>

              {/* NEW: Accepted vs Rejected reply quality */}
              <ChartCard title="Reply Quality by Petition Status (Pass Rate %)" height={240}>
                <BarChart data={metrics.accRej} barSize={44}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9"/>
                  <XAxis dataKey="status" tick={{fontSize:11}}/>
                  <YAxis domain={[0,100]} tickFormatter={(v: number)=>`${v}%`} tick={{fontSize:11}}/>
                  <Tooltip formatter={(v: number)=>`${v}%`}/>
                  <Bar dataKey="passRate" radius={[6,6,0,0]} name="Pass Rate">
                    {metrics.accRej.map(e=>(
                      <Cell key={e.status} fill={e.passRate>=70?'#22c55e':e.passRate>=40?'#f59e0b':'#ef4444'}/>
                    ))}
                    <LabelList dataKey="passRate" position="top" formatter={(v: number)=>`${v}%`} style={{fontSize:11,fontWeight:700}}/>
                  </Bar>
                </BarChart>
              </ChartCard>

              {/* Grievance type F rate */}
              <ChartCard title="Grievance Types with Highest Failure Rate (min 5 petitions)" height={320}>
                <BarChart data={metrics.typeRate} layout="vertical" barSize={18}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9"/>
                  <XAxis type="number" domain={[0,100]} tickFormatter={(v: number)=>`${v}%`} tick={{fontSize:11}}/>
                  <YAxis type="category" dataKey="type" width={200} tick={{fontSize:10}}/>
                  <Tooltip formatter={(v: number)=>`${v}%`}/>
                  <Bar dataKey="fRate" radius={[0,5,5,0]}>
                    {metrics.typeRate.map(e=><Cell key={e.type} fill={e.fRate>=70?'#ef4444':e.fRate>=40?'#f59e0b':'#22c55e'}/>)}
                    <LabelList dataKey="fRate" position="right" formatter={(v: number)=>`${v}%`} style={{fontSize:10,fontWeight:600}}/>
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

          {/* ══════ ESCALATION ══════ */}
          {section === 'escalation' && (
            <div className="space-y-5">
              <div className="flex items-center gap-4 flex-wrap">
                <div className="bg-red-50 border border-red-200 rounded-2xl px-5 py-4 flex items-center gap-3">
                  <AlertTriangle size={22} className="text-red-500"/>
                  <div>
                    <p className="font-bold text-red-700 text-xl">{escalated.length}</p>
                    <p className="text-xs text-red-500">Escalated cases (Age ≥ 30 days + Grade F)</p>
                  </div>
                </div>
                <button
                  onClick={() => {
                    const cols = ['Grievance ID','Petitioner','Department Name','Responsible Officer/பொறுப்பு அதிகாரி','Taluk/வட்டம்','Ticket Age in Days','_officer_reply','Required_Correction_Tamil'] as const;
                    const csv = '﻿' + [cols.join(','),...escalated.map(r=>cols.map(h=>`"${String(r[h as keyof AuditResult]??'').replace(/"/g,'""')}"`).join(','))].join('\n');
                    const a = Object.assign(document.createElement('a'),{href:URL.createObjectURL(new Blob([csv],{type:'text/csv'})),download:'Escalated_Cases.csv'});
                    a.click();
                  }}
                  className="flex items-center gap-2 bg-red-600 text-white rounded-xl px-5 py-2.5 text-sm font-semibold hover:bg-red-700 transition-colors">
                  <Download size={14}/> Export Escalation CSV
                </button>
                <button
                  onClick={() => {
                    const deptCounts: Record<string,number> = {};
                    escalated.forEach(r => { const d = String(r['Department Name']||'?'); deptCounts[d]=(deptCounts[d]||0)+1; });
                    const top = Object.entries(deptCounts).sort((a,b)=>b[1]-a[1]).slice(0,5);
                    const text = `🚨 MYD Escalation Alert\nTotal: ${escalated.length} cases require urgent action (Age ≥ 30 days + Grade F)\n\nTop Departments:\n${top.map(([d,c])=>`• ${d}: ${c}`).join('\n')}\n\nPlease take immediate action.`;
                    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank');
                  }}
                  className="flex items-center gap-2 bg-emerald-600 text-white rounded-xl px-5 py-2.5 text-sm font-semibold hover:bg-emerald-700 transition-colors">
                  <MessageCircle size={14}/> Send WhatsApp Alert
                </button>
              </div>

              <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-red-50 text-red-700 uppercase text-left tracking-wide">
                        {['ID','Petitioner','Department','Officer','Taluk','Age (Days)','Reply (truncated)','Tamil Correction'].map(h=>(
                          <th key={h} className="px-3 py-3 font-semibold whitespace-nowrap">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {escalated.map((r,i)=>(
                        <tr key={i} className="hover:bg-red-50/30">
                          <td className="px-3 py-2.5 font-mono text-slate-500">{String(r['Grievance ID']).slice(-10)}</td>
                          <td className="px-3 py-2.5 text-slate-700">{String(r['Petitioner']||'').slice(0,18)}</td>
                          <td className="px-3 py-2.5 text-slate-600">{shortDept(String(r['Department Name']||''))}</td>
                          <td className="px-3 py-2.5 text-slate-600">{String(r['Responsible Officer/பொறுப்பு அதிகாரி']||'—').slice(0,22)}</td>
                          <td className="px-3 py-2.5 text-slate-500">{shortTaluk(String(r['Taluk/வட்டம்']||''))}</td>
                          <td className="px-3 py-2.5 text-center">
                            <span className="bg-red-100 text-red-700 font-bold px-2 py-0.5 rounded-full">{r['Ticket Age in Days']??'—'}</span>
                          </td>
                          <td className="px-3 py-2.5 text-slate-600 max-w-[180px]">
                            <span className="line-clamp-2">{r._officer_reply.slice(0,100) || '—'}</span>
                          </td>
                          <td className="px-3 py-2.5 text-slate-500 max-w-[180px]">
                            <span className="line-clamp-2">{r.Required_Correction_Tamil.slice(0,100) || '—'}</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {escalated.length === 0 && (
                  <div className="py-12 text-center text-slate-400 text-sm">
                    <CheckCircle2 size={32} className="mx-auto mb-3 text-emerald-400"/>
                    No escalated cases. All long-pending petitions have acceptable replies.
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ══════ REPORTS ══════ */}
          {section === 'reports' && (
            <div className="space-y-5">
              <div className="flex items-center gap-3">
                <input type="text" value={reportSearch} onChange={e=>setReportSearch(e.target.value)}
                  placeholder="Search officer name…"
                  className="border border-slate-200 rounded-xl px-4 py-2 text-sm w-64 focus:outline-none focus:ring-2 focus:ring-indigo-300"/>
                <span className="text-xs text-slate-400">{officerReportData.length} officers</span>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
                {officerReportData
                  .filter(o => o.name.toLowerCase().includes(reportSearch.toLowerCase()))
                  .map(o => (
                    <div key={o.name} className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 space-y-3">
                      <div className="flex items-start justify-between">
                        <div>
                          <p className="font-semibold text-slate-800 text-sm leading-tight">{o.name}</p>
                          <p className="text-xs text-slate-400 mt-0.5">{o.total} total cases</p>
                        </div>
                        <span className={`text-sm font-bold px-2.5 py-1 rounded-xl ${
                          o.failRate >= 70 ? 'bg-red-100 text-red-700' :
                          o.failRate >= 40 ? 'bg-amber-100 text-amber-700' :
                          'bg-emerald-100 text-emerald-700'
                        }`}>{o.failRate}% fail</span>
                      </div>
                      <div className="flex gap-2 text-xs">
                        <span className="bg-emerald-50 text-emerald-700 px-2 py-1 rounded-lg font-medium">A: {o.A}</span>
                        <span className="bg-amber-50 text-amber-700 px-2 py-1 rounded-lg font-medium">C: {o.C}</span>
                        <span className="bg-red-50 text-red-700 px-2 py-1 rounded-lg font-medium">F: {o.F}</span>
                      </div>
                      <div className="flex gap-3 text-xs text-slate-500">
                        <span className="text-emerald-600 font-semibold">{o.pass} passed</span>
                        <span className="text-red-500 font-semibold">{o.fail} failed</span>
                      </div>
                      <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                        <div className={`h-full rounded-full transition-all ${
                          o.failRate>=70?'bg-red-500':o.failRate>=40?'bg-amber-500':'bg-emerald-500'
                        }`} style={{width:`${100-o.failRate}%`}}/>
                      </div>
                      <button onClick={()=>setReportOfficer(o.name)}
                        className="w-full text-xs bg-slate-50 hover:bg-indigo-50 hover:text-indigo-700 border border-slate-200 hover:border-indigo-200 rounded-lg py-1.5 font-medium transition-colors text-slate-600">
                        View Details
                      </button>
                    </div>
                  ))}
              </div>

              {/* Officer Detail Modal */}
              {reportOfficer && (() => {
                const officer = officerReportData.find(o=>o.name===reportOfficer);
                if (!officer) return null;
                return (
                  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={()=>setReportOfficer(null)}>
                    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[85vh] flex flex-col mx-4" onClick={e=>e.stopPropagation()}>
                      <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
                        <div>
                          <p className="font-bold text-slate-800">{officer.name}</p>
                          <p className="text-xs text-slate-400">{officer.total} cases · {officer.failRate}% fail rate</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <button onClick={()=>window.print()}
                            className="flex items-center gap-1.5 text-xs bg-slate-100 hover:bg-slate-200 px-3 py-1.5 rounded-lg transition-colors text-slate-700">
                            <Printer size={13}/> Print
                          </button>
                          <button onClick={()=>setReportOfficer(null)} className="text-slate-400 hover:text-slate-700">
                            <X size={18}/>
                          </button>
                        </div>
                      </div>
                      <div className="overflow-auto flex-1 px-6 py-4">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="bg-slate-50 text-slate-500 uppercase tracking-wide">
                              {['ID','Grade','Status','Age','Reply Snippet'].map(h=>(
                                <th key={h} className="px-3 py-2.5 text-left font-semibold whitespace-nowrap">{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {officer.cases.map((c,i)=>(
                              <tr key={i} className="hover:bg-slate-50">
                                <td className="px-3 py-2.5 font-mono text-slate-500">{String(c['Grievance ID']).slice(-10)}</td>
                                <td className="px-3 py-2.5">
                                  <span className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-white font-bold text-xs ${
                                    c.Audit_Grade==='A'?'bg-emerald-500':c.Audit_Grade==='C'?'bg-amber-500':'bg-red-500'
                                  }`}>{c.Audit_Grade}</span>
                                </td>
                                <td className="px-3 py-2.5 whitespace-nowrap">
                                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                                    c['Status Display']==='Accepted'?'bg-emerald-100 text-emerald-700':
                                    c['Status Display']==='Rejected'?'bg-red-100 text-red-700':'bg-amber-100 text-amber-700'
                                  }`}>{String(c['Status Display'])}</span>
                                </td>
                                <td className="px-3 py-2.5 text-center text-slate-500">{c['Ticket Age in Days']??'—'}</td>
                                <td className="px-3 py-2.5 text-slate-600 max-w-[280px]">
                                  <span className="line-clamp-2">{c._officer_reply.slice(0,100) || '—'}</span>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                );
              })()}
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

                  {/* WhatsApp Weekly Summary */}
                  {results.length > 0 && (
                    <button
                      onClick={() => {
                        const total = results.length;
                        const passed = results.filter(r=>r.Audit_Status==='PASS').length;
                        const failed = total - passed;
                        const passRate = Math.round((passed/total)*100);
                        const deptFail: Record<string,number> = {};
                        results.forEach(r=>{if(r.Audit_Status==='FAIL'){const d=String(r['Department Name']||'?');deptFail[d]=(deptFail[d]||0)+1;}});
                        const worst = Object.entries(deptFail).sort((a,b)=>b[1]-a[1]).slice(0,5);
                        const text = `📊 MYD Grievance Audit — Weekly Summary\n\n✅ Total Audited: ${total}\n✔️ Passed: ${passed} (${passRate}%)\n❌ Failed: ${failed} (${100-passRate}%)\n🚨 Escalated (Age ≥ 30 + Grade F): ${escalated.length}\n\n🏚️ Worst Departments:\n${worst.map(([d,c])=>`• ${d}: ${c} failures`).join('\n')}\n\nPlease review and take action.`;
                        window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank');
                      }}
                      className="w-full flex items-center gap-3 p-4 border border-slate-200 rounded-xl hover:border-emerald-300 hover:bg-emerald-50/30 transition-colors text-left">
                      <div className="w-10 h-10 bg-emerald-100 rounded-xl flex items-center justify-center shrink-0">
                        <MessageCircle size={18} className="text-emerald-600"/>
                      </div>
                      <div>
                        <p className="font-semibold text-slate-800 text-sm">Share via WhatsApp</p>
                        <p className="text-xs text-slate-500">Weekly summary with pass/fail counts and worst departments</p>
                      </div>
                    </button>
                  )}
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
