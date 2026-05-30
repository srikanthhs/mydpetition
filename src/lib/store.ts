/**
 * Firestore persistence for MYD Grievance Audit
 *
 * Structure:
 *   sessions/{deviceId}                    ← metadata doc
 *   sessions/{deviceId}/rowChunks/{n}      ← 200 rows per doc
 *   sessions/{deviceId}/resultChunks/{n}   ← 200 results per doc
 *
 * Each device gets its own session keyed by a random ID stored in localStorage.
 * No auth required — Firestore rules must allow open read/write (set below).
 */

import {
  doc, getDoc, getDocs, setDoc, writeBatch,
  collection, deleteDoc,
} from 'firebase/firestore';
import { db } from './firebase';
import type { GrievanceRow, AuditResult } from './types';

const CHUNK = 200; // rows per Firestore document (well under 1 MB limit)

/* ── Device ID (persisted in localStorage) ── */
export function getDeviceId(): string {
  if (typeof window === 'undefined') return 'ssr';
  let id = localStorage.getItem('myd_device_id');
  if (!id) {
    id = Date.now().toString(36) + Math.random().toString(36).slice(2);
    localStorage.setItem('myd_device_id', id);
  }
  return id;
}

/* ── Metadata ── */
interface SessionMeta {
  fileName: string;
  savedAt: string;
  totalRows: number;
  totalResults: number;
}

/* ── Helpers ── */
function chunks<T>(arr: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += CHUNK) out.push(arr.slice(i, i + CHUNK));
  return out;
}

async function deleteSubcollection(deviceId: string, sub: string) {
  const snap = await getDocs(collection(db, 'sessions', deviceId, sub));
  if (snap.empty) return;
  const b = writeBatch(db);
  snap.docs.forEach(d => b.delete(d.ref));
  await b.commit();
}

/* ════════════════════════════════════════════
   SAVE
════════════════════════════════════════════ */
export async function fsSaveRows(rows: GrievanceRow[], fileName: string): Promise<boolean> {
  try {
    const id = getDeviceId();
    // Write rows in chunk batches (each writeBatch ≤ 500 ops)
    await deleteSubcollection(id, 'rowChunks');
    const rowChunks = chunks(rows);
    for (let i = 0; i < rowChunks.length; i++) {
      const b = writeBatch(db);
      b.set(doc(db, 'sessions', id, 'rowChunks', String(i)), { data: rowChunks[i] });
      await b.commit();
    }
    // Update meta
    await setDoc(doc(db, 'sessions', id), {
      fileName,
      savedAt: new Date().toISOString(),
      totalRows: rows.length,
      totalResults: 0,
    } satisfies SessionMeta);
    return true;
  } catch (e) {
    console.error('fsSaveRows', e);
    return false;
  }
}

export async function fsSaveResults(results: AuditResult[], fileName: string): Promise<boolean> {
  try {
    const id = getDeviceId();
    await deleteSubcollection(id, 'resultChunks');
    const resChunks = chunks(results);
    for (let i = 0; i < resChunks.length; i++) {
      const b = writeBatch(db);
      b.set(doc(db, 'sessions', id, 'resultChunks', String(i)), { data: resChunks[i] });
      await b.commit();
    }
    // Update meta (merge so we don't overwrite totalRows)
    const metaRef = doc(db, 'sessions', id);
    const existing = (await getDoc(metaRef)).data() as SessionMeta | undefined;
    await setDoc(metaRef, {
      fileName,
      savedAt: new Date().toISOString(),
      totalRows: existing?.totalRows ?? 0,
      totalResults: results.length,
    } satisfies SessionMeta);
    return true;
  } catch (e) {
    console.error('fsSaveResults', e);
    return false;
  }
}

/* ════════════════════════════════════════════
   LOAD
════════════════════════════════════════════ */
export async function fsLoad(): Promise<{
  meta: SessionMeta | null;
  rows: GrievanceRow[];
  results: AuditResult[];
}> {
  try {
    const id = getDeviceId();
    const metaSnap = await getDoc(doc(db, 'sessions', id));
    if (!metaSnap.exists()) return { meta: null, rows: [], results: [] };
    const meta = metaSnap.data() as SessionMeta;

    const [rowSnap, resSnap] = await Promise.all([
      getDocs(collection(db, 'sessions', id, 'rowChunks')),
      getDocs(collection(db, 'sessions', id, 'resultChunks')),
    ]);

    const rows: GrievanceRow[] = rowSnap.docs
      .sort((a, b) => Number(a.id) - Number(b.id))
      .flatMap(d => (d.data().data as GrievanceRow[]));

    const results: AuditResult[] = resSnap.docs
      .sort((a, b) => Number(a.id) - Number(b.id))
      .flatMap(d => (d.data().data as AuditResult[]));

    return { meta, rows, results };
  } catch (e) {
    console.error('fsLoad', e);
    return { meta: null, rows: [], results: [] };
  }
}

/* ════════════════════════════════════════════
   CLEAR
════════════════════════════════════════════ */
export async function fsClear(): Promise<void> {
  try {
    const id = getDeviceId();
    await Promise.all([
      deleteSubcollection(id, 'rowChunks'),
      deleteSubcollection(id, 'resultChunks'),
      deleteDoc(doc(db, 'sessions', id)),
    ]);
  } catch (e) {
    console.error('fsClear', e);
  }
}
