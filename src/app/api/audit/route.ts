import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';

/* ── Auto-grade rows that have no reply ── */
function autoGrade(status: string): { Grade: string; Status: string; Audit_Reason_EN: string; Fix_Action_TA: string } {
  const s = (status || '').trim();
  if (['Pending Action', 'Received', 'Pending'].includes(s)) {
    return {
      Grade: 'F', Status: 'FAIL',
      Audit_Reason_EN: `No officer reply recorded. Grievance is still "${s}" with no action text.`,
      Fix_Action_TA: 'இந்த மனுவிற்கு இதுவரை எந்த பதிலும் பதிவு செய்யப்படவில்லை. உரிய நடவடிக்கை எடுத்து குறிப்பிட்ட காலக்கெடுவுடன் பதில் அளிக்கவும்.',
    };
  }
  if (s === 'In Process') {
    return {
      Grade: 'C', Status: 'FAIL',
      Audit_Reason_EN: 'Grievance is in process but no substantive reply text provided yet.',
      Fix_Action_TA: 'மனு செயலில் உள்ளது என்று மட்டும் குறிப்பிட்டுள்ளீர்கள். எப்போது தீர்வு கிடைக்கும் என்ற தேதியையும் சேர்க்கவும்.',
    };
  }
  return {
    Grade: 'F', Status: 'FAIL',
    Audit_Reason_EN: `No officer reply text found for status "${s}".`,
    Fix_Action_TA: 'மனுவிற்கு பதில் இல்லை. விரைவில் பதில் அளிக்கவும்.',
  };
}

/* ── Simulation (offline mode) ── */
function simulateAudit(reply: string, status: string) {
  const r = reply.trim();
  if (!r) return autoGrade(status);
  if (r.length < 25 || r.includes('நடவடிக்கையில் உள்ளது') || r.includes('அனுப்பப்பட்டுள்ளது')) {
    return {
      Grade: 'C', Status: 'FAIL',
      Audit_Reason_EN: 'Reply only states that action has been forwarded/referred. No concrete resolution date or outcome specified.',
      Fix_Action_TA: 'நடவடிக்கை எடுக்கப்படுகிறது என்று மட்டும் கூறியுள்ளீர்கள். இறுதி தீர்வு எப்போது கிடைக்கும் என்ற தேதியை குறிப்பிட வேண்டும்.',
    };
  }
  if (r.includes('பேச்சுவார்த்தை') || r.includes('பரிசீலிக்கப்படும்')) {
    return {
      Grade: 'F', Status: 'FAIL',
      Audit_Reason_EN: 'Vague response — talks/discussions mentioned without any resolution timeline or specific action taken.',
      Fix_Action_TA: 'தெளிவான தீர்வு காலக்கெடுவுடன் பதில் அளிக்கவும். பேச்சுவார்த்தை என்று மட்டும் கூறுவது போதாது.',
    };
  }
  return {
    Grade: 'A', Status: 'PASS',
    Audit_Reason_EN: 'Reply appears to contain substantive action or resolution (simulation).',
    Fix_Action_TA: 'பதில் அங்கீகரிக்கப்பட்டது.',
  };
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const {
    petition_id,
    department,
    sub_department,
    responsible_officer,
    grievance_type,
    citizen_grievance,
    officer_reply,
    status,
  } = body;

  const apiKey = process.env.GEMINI_API_KEY || request.headers.get('x-gemini-key') || '';

  /* No reply → auto-grade without API call */
  if (!officer_reply || !String(officer_reply).trim()) {
    return NextResponse.json(autoGrade(status));
  }

  /* No API key → simulate */
  if (!apiKey) {
    return NextResponse.json(simulateAudit(officer_reply, status));
  }

  const prompt = `You are an expert Government Grievance Auditor for Tamil Nadu's Mudhalvarin Mugavari (CM Helpline) system.

Evaluate the quality of the officer's response to the citizen's grievance.

Assign a Grade:
- A (PASS): Genuine resolution — specific action completed, date mentioned, or concrete outcome described.
- C (FAIL): Partial/vague — action initiated or referred but no completion date or concrete outcome.
- F (FAIL): Deflection — boilerplate text, generic forwarding note, too short (<20 chars), or no real action stated.

---
Grievance ID: ${petition_id}
Department: ${department}
Sub Department: ${sub_department || 'N/A'}
Responsible Officer: ${responsible_officer || 'N/A'}
Grievance Type: ${grievance_type || 'N/A'}
Status: ${status}
Citizen Grievance: ${citizen_grievance}
Officer Reply: ${officer_reply}
---

Return ONLY a valid JSON object (no markdown, no code fences):
{
  "Grade": "A or C or F",
  "Status": "PASS or FAIL",
  "Audit_Reason_EN": "One clear sentence explaining the grade.",
  "Fix_Action_TA": "If FAIL: a specific Tamil instruction to the officer on what to add or correct. If PASS: write பதில் அங்கீகரிக்கப்பட்டது."
}`;

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
    const result = await model.generateContent(prompt);
    let text = result.response.text().trim().replace(/```json?\n?/g, '').replace(/```/g, '').trim();
    return NextResponse.json(JSON.parse(text));
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json(simulateAudit(officer_reply, status));
  }
}
