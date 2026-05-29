'use client';
import { useState, useCallback, useRef, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { GrievanceRow, AuditResult, PreStats } from '@/lib/types';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell, PieChart, Pie, Legend,
} from 'recharts';
import { Upload, LogOut, Download, Play, Shield, AlertCircle, FileSpreadsheet, CheckCircle2, Clock, XCircle } from 'lucide-react';

/* ── helpers ── */
function getOfficerReply(row: GrievanceRow): string {
  return String(row['Reason for Acceptance'] || row['Reason for Rejection'] || '').trim();
}

const STATUS_COLORS: Record<string, string> = {
  'Accepted': '#22c55e',
  'Rejected': '#ef4444',
  'Pending Action': '#f59e0b',
  'Received': '#6366f1',
  'In Process': '#3b82f6',
  'Pending': '#f97316',
  'Accepted and Waitlisted': '#14b8a6',
};

const GRADE_COLORS: Record<string, string> = { A: '#22c55e', C: '#f59e0b', F: '#ef4444' };

export default function Dashboard() {
  const { user, signOut } = useAuth();
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [rows, setRows] = useState<GrievanceRow[]>([]);
  const [results, setResults] = useState<AuditResult[]>([]);
  const [processing, setProcessing] = useState(false);
  const [processed, setProcessed] = useState(0);
  const [apiKey, setApiKey] = useState('');
  const [fileError, setFileError] = useState('');
  const [fileName, setFileName] = useState('');
  const [activeTab, setActiveTab] = useState<'overview' | 'results'>('overview');

  const handleSignOut = async () => { await signOut(); router.push('/'); };

  /* ── File parsing ── */
  const parseFile = useCallback(async (file: File) => {
    setFileError(''); setRows([]); setResults([]); setFileName(file.name);
    try {
      const buffer = await file.arrayBuffer();
      const XLSX = await import('xlsx');
      const wb = XLSX.read(buffer, { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const data = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws);

      if (!data.length) { setFileError('File is empty.'); return; }

      const required = ['Grievance ID', 'Petition Details', 'Department Name', 'Status Display'];
      const missing = required.filter(c => !(c in data[0]));
      if (missing.length) { setFileError(`Missing columns: ${missing.join(', ')}`); return; }

      setRows(data as GrievanceRow[]);
      setActiveTab('overview');
    } catch (e) {
      setFileError(`Failed to read file: ${e instanceof Error ? e.message : 'Unknown error'}`);
    }
  }, []);

  /* ── Pre-processing stats ── */
  const preStats = useMemo((): PreStats | null => {
    if (!rows.length) return null;
    const statusDist: Record<string, number> = {};
    const deptMap: Record<string, number> = {};
    const talukMap: Record<string, number> = {};
    const typeMap: Record<string, number> = {};

    rows.forEach(r => {
      const s = (r['Status Display'] as string) || 'Unknown';
      statusDist[s] = (statusDist[s] || 0) + 1;
      const d = (r['Department Name'] as string) || 'Unknown';
      deptMap[d] = (deptMap[d] || 0) + 1;
      const t = (r['Taluk/வட்டம்'] as string) || 'Unknown';
      talukMap[t] = (talukMap[t] || 0) + 1;
      const ty = (r['Grievance Type/குறையின் வகை'] as string) || 'Unknown';
      typeMap[ty] = (typeMap[ty] || 0) + 1;
    });

    const withReply = rows.filter(r => getOfficerReply(r).length > 0).length;
    return {
      total: rows.length,
      withReply,
      noReply: rows.length - withReply,
      statusDist,
      deptDist: Object.entries(deptMap).sort((a, b) => b[1] - a[1]).slice(0, 8),
      talukDist: Object.entries(talukMap).sort((a, b) => b[1] - a[1]),
      typeDist: Object.entries(typeMap).sort((a, b) => b[1] - a[1]).slice(0, 10),
    };
  }, [rows]);

  /* ── Audit processing ── */
  const startAudit = useCallback(async () => {
    if (!rows.length || processing) return;
    setProcessing(true); setResults([]); setProcessed(0);

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const reply = getOfficerReply(row);
      try {
        const res = await fetch('/api/audit', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(apiKey ? { 'x-gemini-key': apiKey } : {}),
          },
          body: JSON.stringify({
            petition_id: row['Grievance ID'],
            department: row['Department Name'],
            sub_department: row['Sub Department/குறை தொடர்புடைய துணைத்துறை'],
            responsible_officer: row['Responsible Officer/பொறுப்பு அதிகாரி'],
            grievance_type: row['Grievance Type/குறையின் வகை'],
            citizen_grievance: row['Petition Details'],
            officer_reply: reply,
            status: row['Status Display'],
          }),
        });
        const data = await res.json();
        setResults(prev => [...prev, {
          ...row,
          _officer_reply: reply,
          Audit_Grade: data.Grade || 'F',
          Audit_Status: data.Status || 'FAIL',
          English_Analysis: data.Audit_Reason_EN || '',
          Required_Correction_Tamil: data.Fix_Action_TA || '',
        }]);
      } catch {
        setResults(prev => [...prev, {
          ...row,
          _officer_reply: reply,
          Audit_Grade: 'F',
          Audit_Status: 'FAIL',
          English_Analysis: 'Network error during processing.',
          Required_Correction_Tamil: 'பிழை ஏற்பட்டது. மீண்டும் முயற்சிக்கவும்.',
        }]);
      }
      setProcessed(i + 1);
    }

    setProcessing(false);
    setActiveTab('results');
  }, [rows, apiKey, processing]);

  /* ── CSV download ── */
  const downloadCSV = useCallback(() => {
    const cols = [
      'Grievance ID', 'Petitioner', 'Department Name',
      'Responsible Officer/பொறுப்பு அதிகாரி', 'Taluk/வட்டம்',
      'Grievance Type/குறையின் வகை', 'Status Display',
      'Ticket Age in Days', '_officer_reply',
      'Audit_Grade', 'Audit_Status', 'English_Analysis', 'Required_Correction_Tamil',
    ] as const;
    const csvRows = results.map(r =>
      cols.map(h => `"${String((r as Record<string, unknown>)[h] ?? '').replace(/"/g, '""')}"`).join(',')
    );
    const csv = '﻿' + [cols.join(','), ...csvRows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url;
    a.download = 'Mayiladuthurai_Grievance_Audit.csv';
    a.click(); URL.revokeObjectURL(url);
  }, [results]);

  /* ── Derived audit metrics ── */
  const total = results.length;
  const passed = results.filter(r => r.Audit_Status === 'PASS').length;
  const failed = total - passed;
  const passRate = total > 0 ? Math.round((passed / total) * 100) : 0;

  const gradeData = ['A', 'C', 'F'].map(g => ({
    grade: g, count: results.filter(r => r.Audit_Grade === g).length,
  }));

  const deptFailData = Object.entries(
    results.filter(r => r.Audit_Status === 'FAIL').reduce((acc, r) => {
      const d = (r['Department Name'] as string) || 'Unknown';
      acc[d] = (acc[d] || 0) + 1; return acc;
    }, {} as Record<string, number>)
  ).map(([dept, count]) => ({ dept: dept.replace(' Department', '').replace(' and ', ' & '), count }))
    .sort((a, b) => b.count - a.count).slice(0, 8);

  const progressPct = rows.length > 0 ? Math.round((processed / rows.length) * 100) : 0;

  /* ═══════════════════════════════════════════
     RENDER
  ═══════════════════════════════════════════ */
  return (
    <div className="min-h-screen bg-slate-50">

      {/* ── Header ── */}
      <header className="bg-white border-b border-slate-200 px-6 py-3 flex items-center justify-between sticky top-0 z-20 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-indigo-600 rounded-xl flex items-center justify-center">
            <Shield className="text-white" size={18} />
          </div>
          <div>
            <h1 className="font-bold text-slate-900 text-sm leading-none">Mudhalvarin Mugavari — Audit Copilot</h1>
            <p className="text-xs text-slate-400 mt-0.5">Mayiladuthurai District Collectorate</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {user?.photoURL && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={user.photoURL} alt="avatar" className="w-8 h-8 rounded-full ring-2 ring-indigo-100" />
          )}
          <div className="hidden sm:block text-right">
            <p className="text-xs font-medium text-slate-700">{user?.displayName}</p>
            <p className="text-xs text-slate-400">{user?.email}</p>
          </div>
          <button onClick={handleSignOut} className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-800 border border-slate-200 rounded-lg px-2.5 py-1.5 hover:bg-slate-50 transition-colors">
            <LogOut size={13} /> Sign Out
          </button>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-5">

        {/* ── Top row: Upload + API Key ── */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">

          {/* Upload */}
          <div className="lg:col-span-2 bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
            <h2 className="font-semibold text-slate-800 mb-4 flex items-center gap-2 text-sm">
              <FileSpreadsheet size={16} className="text-indigo-600" />
              Upload CM Helpline Export (.xlsx)
            </h2>
            <div
              className="border-2 border-dashed border-slate-200 rounded-xl p-7 text-center cursor-pointer hover:border-indigo-400 hover:bg-indigo-50/20 transition-all"
              onClick={() => fileInputRef.current?.click()}
              onDrop={e => { e.preventDefault(); e.dataTransfer.files[0] && parseFile(e.dataTransfer.files[0]); }}
              onDragOver={e => e.preventDefault()}
            >
              <Upload className="mx-auto text-slate-300 mb-2" size={36} />
              <p className="text-slate-600 font-medium text-sm">Drop your grievances Excel file here</p>
              <p className="text-slate-400 text-xs mt-1">Supports .xlsx format from CM Helpline portal</p>
              <input ref={fileInputRef} type="file" accept=".xlsx,.csv" className="hidden"
                onChange={e => e.target.files?.[0] && parseFile(e.target.files[0])} />
            </div>
            {fileError && (
              <div className="mt-3 flex items-start gap-2 text-sm text-red-700 bg-red-50 px-4 py-2.5 rounded-lg">
                <AlertCircle size={14} className="mt-0.5 shrink-0" /> {fileError}
              </div>
            )}
            {rows.length > 0 && !fileError && (
              <div className="mt-3 flex items-center gap-2 text-sm text-emerald-700 bg-emerald-50 px-4 py-2 rounded-lg">
                <CheckCircle2 size={14} />
                <span className="font-medium">{fileName}</span>
                <span className="text-emerald-600">— {rows.length.toLocaleString()} grievances loaded</span>
              </div>
            )}
          </div>

          {/* API Key + Start */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 flex flex-col gap-4">
            <div>
              <h2 className="font-semibold text-slate-800 mb-2 text-sm">Gemini API Key</h2>
              <input type="password" value={apiKey} onChange={e => setApiKey(e.target.value)}
                placeholder="AIza... (optional)"
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" />
              <p className="text-xs text-slate-400 mt-1.5">
                Free key at{' '}
                <a href="https://aistudio.google.com" target="_blank" rel="noopener noreferrer" className="text-indigo-500 hover:underline">aistudio.google.com</a>
                . Leave blank for simulation.
              </p>
            </div>
            {preStats && (
              <div className="bg-slate-50 rounded-xl p-3 text-xs space-y-1.5">
                <div className="flex justify-between text-slate-600">
                  <span>Total grievances</span><span className="font-bold text-slate-800">{preStats.total.toLocaleString()}</span>
                </div>
                <div className="flex justify-between text-slate-600">
                  <span>With officer reply</span><span className="font-bold text-emerald-700">{preStats.withReply.toLocaleString()}</span>
                </div>
                <div className="flex justify-between text-slate-600">
                  <span>No reply (auto-F)</span><span className="font-bold text-amber-600">{preStats.noReply.toLocaleString()}</span>
                </div>
              </div>
            )}
            <button onClick={startAudit} disabled={!rows.length || processing}
              className="mt-auto w-full flex items-center justify-center gap-2 bg-indigo-600 text-white rounded-xl py-3 text-sm font-semibold hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
              <Play size={14} />
              {processing ? `Processing ${processed.toLocaleString()} / ${rows.length.toLocaleString()}…`
                : rows.length ? `Start Audit (${rows.length.toLocaleString()} rows)` : 'Start Audit'}
            </button>
          </div>
        </div>

        {/* ── Progress bar ── */}
        {processing && (
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
            <div className="flex justify-between text-xs text-slate-500 mb-2">
              <span>Auditing petition {processed.toLocaleString()} of {rows.length.toLocaleString()}…</span>
              <span className="font-bold text-indigo-600">{progressPct}%</span>
            </div>
            <div className="h-2.5 bg-slate-100 rounded-full overflow-hidden">
              <div className="h-full bg-indigo-600 rounded-full transition-all duration-300" style={{ width: `${progressPct}%` }} />
            </div>
            <p className="text-xs text-slate-400 mt-2">
              {preStats && processed <= preStats.withReply
                ? `🤖 Calling Gemini for rows with officer replies…`
                : `⚡ Auto-grading pending/received rows (no API call)…`}
            </p>
          </div>
        )}

        {/* ── Tabs ── */}
        {rows.length > 0 && (
          <div className="flex gap-1 bg-slate-100 rounded-xl p-1 w-fit">
            {(['overview', 'results'] as const).map(tab => (
              <button key={tab} onClick={() => setActiveTab(tab)}
                className={`px-5 py-1.5 rounded-lg text-sm font-medium transition-colors capitalize ${activeTab === tab ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
                {tab === 'overview' ? '📊 Data Overview' : `✅ Audit Results${results.length ? ` (${results.length})` : ''}`}
              </button>
            ))}
          </div>
        )}

        {/* ══════════════════════════════
            TAB: DATA OVERVIEW
        ══════════════════════════════ */}
        {activeTab === 'overview' && preStats && (
          <div className="space-y-5">

            {/* Status cards */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              {[
                { label: 'Total Grievances', value: preStats.total, icon: <FileSpreadsheet size={18} />, color: 'indigo' },
                { label: 'Accepted', value: preStats.statusDist['Accepted'] || 0, icon: <CheckCircle2 size={18} />, color: 'green' },
                { label: 'Pending Action', value: (preStats.statusDist['Pending Action'] || 0) + (preStats.statusDist['Received'] || 0), icon: <Clock size={18} />, color: 'amber' },
                { label: 'Rejected', value: preStats.statusDist['Rejected'] || 0, icon: <XCircle size={18} />, color: 'red' },
              ].map(({ label, value, icon, color }) => (
                <div key={label} className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
                  <div className={`w-9 h-9 rounded-xl flex items-center justify-center mb-3 ${
                    color === 'indigo' ? 'bg-indigo-100 text-indigo-600' :
                    color === 'green' ? 'bg-emerald-100 text-emerald-600' :
                    color === 'amber' ? 'bg-amber-100 text-amber-600' : 'bg-red-100 text-red-600'
                  }`}>{icon}</div>
                  <p className="text-2xl font-bold text-slate-800">{value.toLocaleString()}</p>
                  <p className="text-xs text-slate-500 mt-1">{label}</p>
                </div>
              ))}
            </div>

            {/* Charts row 1: Status + Taluk */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
                <h3 className="font-semibold text-slate-800 text-sm mb-4">Grievance Status Distribution</h3>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={Object.entries(preStats.statusDist).map(([s, c]) => ({ status: s.replace(' Action', ''), count: c }))} barSize={36}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                    <XAxis dataKey="status" tick={{ fontSize: 10 }} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                    <Tooltip contentStyle={{ borderRadius: 8, border: '1px solid #e2e8f0', fontSize: 12 }} />
                    <Bar dataKey="count" radius={[5, 5, 0, 0]}>
                      {Object.entries(preStats.statusDist).map(([s]) => (
                        <Cell key={s} fill={STATUS_COLORS[s] || '#94a3b8'} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>

              <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
                <h3 className="font-semibold text-slate-800 text-sm mb-4">Grievances by Taluk</h3>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={preStats.talukDist.map(([t, c]) => ({ taluk: t.replace(/\s*\(\d+\)/, ''), count: c }))} layout="vertical" barSize={20}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                    <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} />
                    <YAxis type="category" dataKey="taluk" width={110} tick={{ fontSize: 11 }} />
                    <Tooltip contentStyle={{ borderRadius: 8, border: '1px solid #e2e8f0', fontSize: 12 }} />
                    <Bar dataKey="count" fill="#6366f1" radius={[0, 5, 5, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Charts row 2: Departments + Grievance Types */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
                <h3 className="font-semibold text-slate-800 text-sm mb-4">Top Departments</h3>
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={preStats.deptDist.map(([d, c]) => ({ dept: d.replace(' Department', '').replace(' and ', ' & ').slice(0, 30), count: c }))} layout="vertical" barSize={18}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                    <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} />
                    <YAxis type="category" dataKey="dept" width={160} tick={{ fontSize: 10 }} />
                    <Tooltip contentStyle={{ borderRadius: 8, border: '1px solid #e2e8f0', fontSize: 12 }} />
                    <Bar dataKey="count" fill="#8b5cf6" radius={[0, 5, 5, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>

              <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
                <h3 className="font-semibold text-slate-800 text-sm mb-4">Top Grievance Types</h3>
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={preStats.typeDist.map(([t, c]) => ({ type: t.slice(0, 28), count: c }))} layout="vertical" barSize={18}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                    <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} />
                    <YAxis type="category" dataKey="type" width={165} tick={{ fontSize: 10 }} />
                    <Tooltip contentStyle={{ borderRadius: 8, border: '1px solid #e2e8f0', fontSize: 12 }} />
                    <Bar dataKey="count" fill="#0ea5e9" radius={[0, 5, 5, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        )}

        {/* ══════════════════════════════
            TAB: AUDIT RESULTS
        ══════════════════════════════ */}
        {activeTab === 'results' && results.length > 0 && (
          <div className="space-y-5">

            {/* Metric cards */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
                <p className="text-xs text-slate-500 mb-1">Total Audited</p>
                <p className="text-3xl font-bold text-indigo-600">{total.toLocaleString()}</p>
              </div>
              <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
                <p className="text-xs text-slate-500 mb-1">Grade A (Pass)</p>
                <p className="text-3xl font-bold text-emerald-600">{passed.toLocaleString()}</p>
                <p className="text-xs text-slate-400 mt-1">{passRate}% pass rate</p>
              </div>
              <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
                <p className="text-xs text-slate-500 mb-1">Grade C / F (Fail)</p>
                <p className="text-3xl font-bold text-red-500">{failed.toLocaleString()}</p>
                <p className="text-xs text-slate-400 mt-1">needs revision</p>
              </div>
              <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
                <p className="text-xs text-slate-500 mb-1">Quality Class</p>
                <p className={`text-3xl font-bold ${passRate >= 70 ? 'text-emerald-600' : 'text-amber-500'}`}>
                  {passRate >= 70 ? 'Grade B' : 'Grade C'}
                </p>
                <p className="text-xs text-slate-400 mt-1">{passRate >= 70 ? 'Acceptable' : 'Below Standard'}</p>
              </div>
            </div>

            {/* Audit charts */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
                <h3 className="font-semibold text-slate-800 text-sm mb-4">Audit Grade Distribution</h3>
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={gradeData} barSize={56}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                    <XAxis dataKey="grade" tick={{ fontWeight: 700, fontSize: 14 }} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                    <Tooltip contentStyle={{ borderRadius: 8, fontSize: 12 }} />
                    <Bar dataKey="count" radius={[6, 6, 0, 0]}>
                      {gradeData.map(e => <Cell key={e.grade} fill={GRADE_COLORS[e.grade]} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>

              <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
                <h3 className="font-semibold text-slate-800 text-sm mb-4">Failed Responses by Department</h3>
                {deptFailData.length > 0 ? (
                  <ResponsiveContainer width="100%" height={200}>
                    <BarChart data={deptFailData} layout="vertical" barSize={16}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                      <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} />
                      <YAxis type="category" dataKey="dept" width={145} tick={{ fontSize: 10 }} />
                      <Tooltip contentStyle={{ borderRadius: 8, fontSize: 12 }} />
                      <Bar dataKey="count" fill="#ef4444" radius={[0, 5, 5, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="h-44 flex items-center justify-center text-emerald-600 text-sm font-medium">✓ All departments passed!</div>
                )}
              </div>
            </div>

            {/* Results table */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-semibold text-slate-800 text-sm">Full Audit Results — {results.length.toLocaleString()} rows</h3>
                <button onClick={downloadCSV}
                  className="flex items-center gap-2 bg-slate-900 text-white rounded-lg px-4 py-2 text-xs font-semibold hover:bg-slate-700 transition-colors">
                  <Download size={13} /> Download CSV
                </button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-slate-50 text-slate-500 uppercase tracking-wide text-left">
                      {['Grievance ID', 'Petitioner', 'Department', 'Taluk', 'Type', 'Status', 'Age', 'Grade', 'Audit', 'Analysis', 'Correction (Tamil)'].map(h => (
                        <th key={h} className="px-3 py-3 font-semibold whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {results.map((r, i) => (
                      <tr key={i} className="hover:bg-slate-50 transition-colors">
                        <td className="px-3 py-2.5 font-mono text-slate-600 whitespace-nowrap text-xs">{String(r['Grievance ID']).slice(-12)}</td>
                        <td className="px-3 py-2.5 text-slate-700 whitespace-nowrap">{String(r['Petitioner'] || '').slice(0, 18)}</td>
                        <td className="px-3 py-2.5 text-slate-600 whitespace-nowrap">{String(r['Department Name'] || '').replace(' Department', '').slice(0, 22)}</td>
                        <td className="px-3 py-2.5 text-slate-500 whitespace-nowrap">{String(r['Taluk/வட்டம்'] || '').replace(/\s*\(\d+\)/, '')}</td>
                        <td className="px-3 py-2.5 text-slate-500 max-w-[120px] truncate">{String(r['Grievance Type/குறையின் வகை'] || '')}</td>
                        <td className="px-3 py-2.5 whitespace-nowrap">
                          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                            r['Status Display'] === 'Accepted' ? 'bg-emerald-100 text-emerald-700' :
                            r['Status Display'] === 'Rejected' ? 'bg-red-100 text-red-700' :
                            'bg-amber-100 text-amber-700'
                          }`}>{String(r['Status Display'])}</span>
                        </td>
                        <td className="px-3 py-2.5 text-slate-500 text-center">{r['Ticket Age in Days'] ?? '—'}</td>
                        <td className="px-3 py-2.5">
                          <span className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-white font-bold text-xs ${
                            r.Audit_Grade === 'A' ? 'bg-emerald-500' : r.Audit_Grade === 'C' ? 'bg-amber-500' : 'bg-red-500'
                          }`}>{r.Audit_Grade}</span>
                        </td>
                        <td className="px-3 py-2.5">
                          <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${
                            r.Audit_Status === 'PASS' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'
                          }`}>{r.Audit_Status}</span>
                        </td>
                        <td className="px-3 py-2.5 text-slate-600 max-w-[200px]">
                          <span className="line-clamp-2" title={r.English_Analysis}>{r.English_Analysis}</span>
                        </td>
                        <td className="px-3 py-2.5 text-slate-500 max-w-[200px]">
                          <span className="line-clamp-2" title={r.Required_Correction_Tamil}>{r.Required_Correction_Tamil}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ── Empty state ── */}
        {!rows.length && (
          <div className="bg-indigo-50 border border-indigo-100 rounded-2xl p-6">
            <h3 className="font-semibold text-indigo-900 mb-3 text-sm">Expected Excel Format (CM Helpline Export)</h3>
            <div className="overflow-x-auto">
              <table className="text-xs">
                <thead>
                  <tr>
                    {['Grievance ID', 'Petitioner', 'Petition Details', 'Reason for Acceptance', 'Department Name', 'Status Display', 'Taluk/வட்டம்', 'Ticket Age in Days'].map(h => (
                      <th key={h} className="px-3 py-2 text-left font-semibold text-indigo-700 border-b border-indigo-200 whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="px-3 py-2 text-indigo-800 font-mono">TN/REV/MLD/...</td>
                    <td className="px-3 py-2 text-indigo-700">LAKSHMI</td>
                    <td className="px-3 py-2 text-indigo-600 max-w-xs truncate">பட்டா மாற்றம் செய்ய...</td>
                    <td className="px-3 py-2 text-indigo-600">நடவடிக்கையில் உள்ளது...</td>
                    <td className="px-3 py-2 text-indigo-700">Revenue and Disaster...</td>
                    <td className="px-3 py-2"><span className="bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full">Accepted</span></td>
                    <td className="px-3 py-2 text-indigo-600">Mayiladuthurai (5)</td>
                    <td className="px-3 py-2 text-indigo-700 text-center">18</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        )}

      </main>
    </div>
  );
}
