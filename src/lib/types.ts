export interface GrievanceRow {
  Petition_ID: string;
  Department: string;
  Citizen_Grievance: string;
  Officer_Reply: string;
}

export interface AuditResult extends GrievanceRow {
  Audit_Grade: 'A' | 'C' | 'F';
  Audit_Status: 'PASS' | 'FAIL';
  English_Analysis: string;
  Required_Correction_Tamil: string;
}
