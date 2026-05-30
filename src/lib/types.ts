export interface GrievanceRow {
  'Grievance ID': string;
  'Petitioner': string;
  'Department Name': string;
  'Sub Department/குறை தொடர்புடைய துணைத்துறை'?: string;
  'Responsible Officer/பொறுப்பு அதிகாரி'?: string;
  'Petition Details': string;
  'Reason for Acceptance'?: string;
  'Reason for Rejection'?: string;
  'Status Display': string;
  'Taluk/வட்டம்'?: string;
  'Grievance Type/குறையின் வகை'?: string;
  'Ticket Age in Days'?: number;
  'Days of Pending'?: number;
  'Mobile Number'?: string;
  'Petitioner Mobile'?: string;
  'Mobile No'?: string;
  [key: string]: unknown;
}

export interface AuditResult extends GrievanceRow {
  _officer_reply: string;
  Audit_Grade: 'A' | 'C' | 'F' | '-';
  Audit_Status: 'PASS' | 'FAIL' | 'SKIP';
  English_Analysis: string;
  Required_Correction_Tamil: string;
}

export interface PreStats {
  total: number;
  withReply: number;
  noReply: number;
  statusDist: Record<string, number>;
  deptDist: [string, number][];
  talukDist: [string, number][];
  typeDist: [string, number][];
}
