'use client';
import { useState, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { GrievanceRow, AuditResult } from '@/lib/types';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Cell,
} from 'recharts';
import { Upload, LogOut, Download, Play, Shield, ChevronRight, AlertCircle } from 'lucide-react';

const REQUIRED_COLS = ['Petition_ID', 'Department', 'Citizen_Grievance', 'Officer_Reply'];

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

  const handleSignOut = async () => {
    await signOut();
    router.push('/');
  };

  const parseFile = useCallback(async (file: File) => {
    setFileError('');
    setRows([]);
    setResults([]);
    setFileName(file.name);

    try {
      let data: Record<string, string>[] = [];

      if (file.name.endsWith('.csv')) {
        const text = await file.text();
        const { default: Papa } = await import('papaparse');
        const result = Papa.parse<Record<string, string>>(text, {
          header: true,
          skipEmptyLines: true,
        });
        data = result.data;
      } else {
        const buffer = await file.arrayBuffer();
        const XLSX = await import('xlsx');
        const wb = XLSX.read(buffer, { type: 'array' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        data = XLSX.utils.sheet_to_json<Record<string, string>>(ws);
      }

      if (data.length === 0) {
        setFileError('File is empty or could not be parsed.');
        return;
      }

      const missing = REQUIRED_COLS.filter(c => !Object.keys(data[0]).includes(c));
      if (missing.length > 0) {
        setFileError(`Missing required columns: ${missing.join(', ')}`);
        return;
      }

      setRows(data as unknown as GrievanceRow[]);
    } catch (e) {
      setFileError(`Failed to read file: ${e instanceof Error ? e.message : 'Unknown error'}`);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) parseFile(file);
  }, [parseFile]);

  const startAudit = useCallback(async () => {
    if (rows.length === 0 || processing) return;
    setProcessing(true);
    setResults([]);
    setProcessed(0);

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      try {
        const res = await fetch('/api/audit', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(apiKey ? { 'x-gemini-key': apiKey } : {}),
          },
          body: JSON.stringify({
            petition_id: row.Petition_ID,
            department: row.Department,
            citizen_grievance: row.Citizen_Grievance,
            officer_reply: row.Officer_Reply,
          }),
        });
        const data = await res.json();
        setResults(prev => [...prev, {
          ...row,
          Audit_Grade: data.Grade || 'F',
          Audit_Status: data.Status || 'FAIL',
          English_Analysis: data.Audit_Reason_EN || '',
          Required_Correction_Tamil: data.Fix_Action_TA || '',
        }]);
      } catch {
        setResults(prev => [...prev, {
          ...row,
          Audit_Grade: 'F',
          Audit_Status: 'FAIL',
          English_Analysis: 'Network error during processing.',
          Required_Correction_Tamil: 'பிழை ஏற்பட்டது. மீண்டும் முயற்சிக்கவும்.',
        }]);
      }
      setProcessed(i + 1);
    }

    setProcessing(false);
  }, [rows, apiKey, processing]);

  const downloadCSV = useCallback(() => {
    const headers: (keyof AuditResult)[] = [
      'Petition_ID', 'Department', 'Citizen_Grievance', 'Officer_Reply',
      'Audit_Grade', 'Audit_Status', 'English_Analysis', 'Required_Correction_Tamil',
    ];
    const csvRows = results.map(r =>
      headers.map(h => `"${String(r[h] || '').replace(/"/g, '""')}"`).join(',')
    );
    const csv = '﻿' + [headers.join(','), ...csvRows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'Mayiladuthurai_Audited_Grievances.csv';
    a.click();
    URL.revokeObjectURL(url);
  }, [results]);

  // Derived metrics
  const total = results.length;
  const passed = results.filter(r => r.Audit_Status === 'PASS').length;
  const failed = total - passed;
  const passRate = total > 0 ? Math.round((passed / total) * 100) : 0;

  const gradeData = ['A', 'C', 'F'].map(g => ({
    grade: g,
    count: results.filter(r => r.Audit_Grade === g).length,
  }));
  const gradeColors: Record<string, string> = { A: '#22c55e', C: '#f59e0b', F: '#ef4444' };

  const deptFailData = Object.entries(
    results
      .filter(r => r.Audit_Status === 'FAIL')
      .reduce((acc, r) => {
        acc[r.Department] = (acc[r.Department] || 0) + 1;
        return acc;
      }, {} as Record<string, number>)
  )
    .map(([dept, count]) => ({ dept, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);

  const progressPct = rows.length > 0 ? Math.round((processed / rows.length) * 100) : 0;

  return (
    <div className="min-h-screen bg-gray-50">

      {/* ── Header ── */}
      <header className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <Shield className="text-indigo-600" size={26} />
          <div>
            <h1 className="font-bold text-gray-900 leading-none">Mudhalvarin Mugavari Audit</h1>
            <p className="text-xs text-gray-400">Mayiladuthurai District Collectorate</p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className="hidden sm:block text-right">
            <p className="text-sm font-medium text-gray-700">{user?.displayName}</p>
            <p className="text-xs text-gray-400">{user?.email}</p>
          </div>
          {user?.photoURL && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={user.photoURL} alt="avatar" className="w-9 h-9 rounded-full ring-2 ring-indigo-100" />
          )}
          <button
            onClick={handleSignOut}
            className="flex items-center gap-1.5 text-sm text-gray-600 hover:text-gray-900 border border-gray-200 rounded-lg px-3 py-1.5 hover:bg-gray-50 transition-colors"
          >
            <LogOut size={14} />
            <span className="hidden sm:inline">Sign Out</span>
          </button>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-8 space-y-6">

        {/* ── Upload + API Key Row ── */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

          {/* File Upload */}
          <div className="lg:col-span-2 bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
            <h2 className="font-semibold text-gray-800 mb-4 flex items-center gap-2">
              <Upload size={17} className="text-indigo-600" />
              Upload Grievance Spreadsheet
            </h2>
            <div
              className="border-2 border-dashed border-gray-300 rounded-xl p-8 text-center cursor-pointer hover:border-indigo-400 hover:bg-indigo-50/30 transition-colors"
              onDrop={handleDrop}
              onDragOver={e => e.preventDefault()}
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload className="mx-auto text-gray-300 mb-3" size={40} />
              <p className="text-gray-600 font-medium">Drop your CSV or Excel file here</p>
              <p className="text-gray-400 text-sm mt-1">or click to browse</p>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,.xlsx"
                className="hidden"
                onChange={e => e.target.files?.[0] && parseFile(e.target.files[0])}
              />
            </div>

            {fileError && (
              <div className="mt-3 flex items-start gap-2 text-sm text-red-700 bg-red-50 px-4 py-3 rounded-lg">
                <AlertCircle size={15} className="mt-0.5 shrink-0" />
                {fileError}
              </div>
            )}
            {rows.length > 0 && !fileError && (
              <div className="mt-3 flex items-center gap-2 text-sm text-green-700 bg-green-50 px-4 py-2.5 rounded-lg">
                <span className="font-medium">{fileName}</span>
                <ChevronRight size={13} />
                <span>{rows.length} records loaded and ready</span>
              </div>
            )}
          </div>

          {/* API Key + Start Button */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6 flex flex-col gap-4">
            <div>
              <h2 className="font-semibold text-gray-800 mb-3">Gemini API Key</h2>
              <input
                type="password"
                value={apiKey}
                onChange={e => setApiKey(e.target.value)}
                placeholder="AIza... (optional)"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
              />
              <p className="text-xs text-gray-400 mt-1.5">
                Leave blank to run in offline simulation mode.
                Get a free key at{' '}
                <a
                  href="https://aistudio.google.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-indigo-500 hover:underline"
                >
                  aistudio.google.com
                </a>
              </p>
            </div>

            <div className="mt-auto">
              {apiKey && (
                <div className="mb-3 flex items-center gap-1.5 text-xs text-green-700 bg-green-50 px-3 py-1.5 rounded-lg">
                  <span className="w-2 h-2 rounded-full bg-green-500" />
                  Live Gemini mode active
                </div>
              )}
              {!apiKey && (
                <div className="mb-3 flex items-center gap-1.5 text-xs text-amber-700 bg-amber-50 px-3 py-1.5 rounded-lg">
                  <span className="w-2 h-2 rounded-full bg-amber-500" />
                  Offline simulation mode
                </div>
              )}
              <button
                onClick={startAudit}
                disabled={rows.length === 0 || processing}
                className="w-full flex items-center justify-center gap-2 bg-indigo-600 text-white rounded-xl py-3 font-semibold hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                <Play size={15} />
                {processing
                  ? `Auditing ${processed} / ${rows.length}...`
                  : `Start Bulk Audit${rows.length > 0 ? ` (${rows.length})` : ''}`}
              </button>
            </div>
          </div>
        </div>

        {/* ── Progress Bar ── */}
        {processing && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
            <div className="flex justify-between text-sm text-gray-600 mb-2">
              <span>Processing petition {processed} of {rows.length}…</span>
              <span className="font-semibold text-indigo-600">{progressPct}%</span>
            </div>
            <div className="h-3 bg-gray-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-indigo-600 rounded-full transition-all duration-300"
                style={{ width: `${progressPct}%` }}
              />
            </div>
          </div>
        )}

        {/* ── Results Section ── */}
        {results.length > 0 && (
          <>
            {/* Metric Cards */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-5">
                <p className="text-sm text-gray-500">Total Audited</p>
                <p className="text-3xl font-bold mt-1 text-indigo-600">{total}</p>
                <p className="text-xs text-gray-400 mt-1">records</p>
              </div>
              <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-5">
                <p className="text-sm text-gray-500">Approved (Pass)</p>
                <p className="text-3xl font-bold mt-1 text-green-600">{passed}</p>
                <p className="text-xs text-gray-400 mt-1">{passRate}% pass rate</p>
              </div>
              <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-5">
                <p className="text-sm text-gray-500">Rejected (Fail)</p>
                <p className="text-3xl font-bold mt-1 text-red-600">{failed}</p>
                <p className="text-xs text-gray-400 mt-1">requires revision</p>
              </div>
              <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-5">
                <p className="text-sm text-gray-500">Quality Class</p>
                <p className={`text-3xl font-bold mt-1 ${passRate >= 70 ? 'text-green-600' : 'text-amber-600'}`}>
                  {passRate >= 70 ? 'Grade B' : 'Grade C'}
                </p>
                <p className="text-xs text-gray-400 mt-1">
                  {passRate >= 70 ? 'Acceptable' : 'Needs Improvement'}
                </p>
              </div>
            </div>

            {/* Charts */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
                <h3 className="font-semibold text-gray-800 mb-5">Grade Distribution</h3>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={gradeData} barSize={52}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="grade" tick={{ fontWeight: 600 }} />
                    <YAxis allowDecimals={false} />
                    <Tooltip
                      formatter={(v: number) => [v, 'Petitions']}
                      contentStyle={{ borderRadius: 8, border: '1px solid #e5e7eb' }}
                    />
                    <Bar dataKey="count" radius={[6, 6, 0, 0]}>
                      {gradeData.map(entry => (
                        <Cell key={entry.grade} fill={gradeColors[entry.grade]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>

              <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
                <h3 className="font-semibold text-gray-800 mb-5">Failures by Department</h3>
                {deptFailData.length > 0 ? (
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={deptFailData} layout="vertical" barSize={18}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                      <XAxis type="number" allowDecimals={false} />
                      <YAxis
                        type="category"
                        dataKey="dept"
                        width={130}
                        tick={{ fontSize: 11 }}
                      />
                      <Tooltip
                        formatter={(v: number) => [v, 'Failures']}
                        contentStyle={{ borderRadius: 8, border: '1px solid #e5e7eb' }}
                      />
                      <Bar dataKey="count" fill="#6366f1" radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="h-48 flex items-center justify-center text-green-600 font-medium text-sm">
                    ✓ All departments passed quality checks
                  </div>
                )}
              </div>
            </div>

            {/* Results Table */}
            <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-semibold text-gray-800">Full Audit Results Log</h3>
                <button
                  onClick={downloadCSV}
                  className="flex items-center gap-2 bg-gray-900 text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-gray-700 transition-colors"
                >
                  <Download size={14} />
                  Download CSV
                </button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 text-gray-600 text-left text-xs uppercase tracking-wide">
                      {['Petition ID', 'Department', 'Grade', 'Status', 'Analysis (EN)', 'Correction (Tamil)'].map(h => (
                        <th key={h} className="px-4 py-3 font-semibold whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {results.map((r, i) => (
                      <tr key={i} className="hover:bg-gray-50 transition-colors">
                        <td className="px-4 py-3 font-medium text-gray-900 whitespace-nowrap">{r.Petition_ID}</td>
                        <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{r.Department}</td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center justify-center w-7 h-7 rounded-full text-white font-bold text-xs ${
                            r.Audit_Grade === 'A' ? 'bg-green-500' :
                            r.Audit_Grade === 'C' ? 'bg-amber-500' : 'bg-red-500'
                          }`}>
                            {r.Audit_Grade}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                            r.Audit_Status === 'PASS'
                              ? 'bg-green-100 text-green-700'
                              : 'bg-red-100 text-red-700'
                          }`}>
                            {r.Audit_Status}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-gray-600 max-w-xs">
                          <span title={r.English_Analysis} className="line-clamp-2">
                            {r.English_Analysis}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-gray-500 max-w-xs">
                          <span title={r.Required_Correction_Tamil} className="line-clamp-2">
                            {r.Required_Correction_Tamil}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}

        {/* ── Format Guide (shown when no data loaded) ── */}
        {rows.length === 0 && !processing && (
          <div className="bg-indigo-50 border border-indigo-100 rounded-2xl p-6">
            <h3 className="font-semibold text-indigo-900 mb-4">Required Spreadsheet Column Format</h3>
            <div className="overflow-x-auto">
              <table className="text-sm w-full">
                <thead>
                  <tr>
                    {['Petition_ID', 'Department', 'Citizen_Grievance', 'Officer_Reply'].map(h => (
                      <th key={h} className="px-4 py-2.5 text-left font-semibold text-indigo-700 border-b border-indigo-200 whitespace-nowrap">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="px-4 py-2.5 text-indigo-800 font-medium">MDU-101</td>
                    <td className="px-4 py-2.5 text-indigo-800">CIVIL SUPPLIES</td>
                    <td className="px-4 py-2.5 text-indigo-700">கொள்ளிடம் கடையில் மண்ணெண்ணெய் இல்லை</td>
                    <td className="px-4 py-2.5 text-indigo-600">பரிசீலிக்கப்படும்</td>
                  </tr>
                  <tr>
                    <td className="px-4 py-2.5 text-indigo-800 font-medium">MDU-102</td>
                    <td className="px-4 py-2.5 text-indigo-800">REVENUE</td>
                    <td className="px-4 py-2.5 text-indigo-700">பட்டா மாற்றம் தாமதம்</td>
                    <td className="px-4 py-2.5 text-indigo-600">மனு அனுப்பப்பட்டுள்ளது. நாட்கள் ஆகும்.</td>
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
