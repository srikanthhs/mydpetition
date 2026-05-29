import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';

function simulateAudit(reply: string) {
  const r = String(reply || '').trim();
  if (r.length < 20) {
    return {
      Grade: 'F', Status: 'FAIL',
      Audit_Reason_EN: 'Reply is too short or empty. No substantive action described.',
      Audit_Fix_TA: 'மனுவிற்கு விரிவான பதில் அளிக்கவும். செய்யப்பட்ட நடவடிக்கைகளை தெளிவாக குறிப்பிடவும்.',
    };
  }
  if (r.includes('பரிசீலிக்கப்படும்') || r.includes('நாட்கள் ஆகும்')) {
    return {
      Grade: 'F', Status: 'FAIL',
      Audit_Reason_EN: 'Vague boilerplate closure. No specific date, budget, or action provided.',
      Audit_Fix_TA: 'மனுதாரரின் குறைக்கு எப்போது தீர்வு காணப்படும் என்ற தெளிவான காலக்கெடுவைக் குறிப்பிட்டு பதிலை மாற்றவும்.',
    };
  }
  if (r.includes('நிதி') || r.includes('அனுப்பப்பட்டுள்ளது')) {
    return {
      Grade: 'C', Status: 'FAIL',
      Audit_Reason_EN: 'Pass-through or budget-pending response. Timeline not confirmed.',
      Audit_Fix_TA: 'நிதி ஒதுக்கீடு எப்போது பெறப்படும் அல்லது மாற்று ஏற்பாடுகள் என்ன என்பதைப் பதிவிடவும்.',
    };
  }
  return {
    Grade: 'A', Status: 'PASS',
    Audit_Reason_EN: 'Response appears substantive (offline simulation).',
    Audit_Fix_TA: 'பதில் அங்கீகரிக்கப்பட்டது.',
  };
}

export async function POST(request: NextRequest) {
  const { petition_id, department, citizen_grievance, officer_reply } = await request.json();

  const apiKey =
    process.env.GEMINI_API_KEY ||
    request.headers.get('x-gemini-key') ||
    '';

  if (!apiKey) {
    const sim = simulateAudit(officer_reply);
    return NextResponse.json({
      Grade: sim.Grade,
      Status: sim.Status,
      Audit_Reason_EN: sim.Audit_Reason_EN,
      Fix_Action_TA: sim.Audit_Fix_TA,
    });
  }

  const prompt = `You are an elite Government Auditor evaluating public grievance resolution quality.
Compare the citizen's grievance against the officer's reply and assign a Grade:
- A: True Resolution — specific dates, budget amounts, or completed actions provided.
- C: Postponement/Vague — promises future action but no fixed timeline or budget.
- F: Deflection/Fake Closure — blank, copy-pasted boilerplate, wrong routing, or reply shorter than 15 characters.

Department: ${department}
Petition ID: ${petition_id}
Citizen Grievance: ${citizen_grievance}
Officer Reply: ${officer_reply}

Return ONLY a valid JSON object — no markdown, no code fences, nothing else:
{
  "Grade": "A or C or F",
  "Status": "PASS or FAIL",
  "Audit_Reason_EN": "One sentence English analysis explaining the merit or flaw.",
  "Fix_Action_TA": "If FAIL: a polite formal Tamil instruction to the officer on what to add. If PASS: write பதில் அங்கீகரிக்கப்பட்டது."
}`;

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
    const result = await model.generateContent(prompt);
    let text = result.response.text().trim();

    if (text.startsWith('```')) {
      text = text.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
    }

    const parsed = JSON.parse(text);
    return NextResponse.json(parsed);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({
      Grade: 'F',
      Status: 'FAIL',
      Audit_Reason_EN: `Processing error: ${message.slice(0, 120)}`,
      Fix_Action_TA: 'மறுபடியும் முயற்சிக்கவும்.',
    });
  }
}
