export interface AccountAuditResponse {
  accountId: number;
  currentBalance: string;
  calculatedBalance: string;
  difference: string;
  isValid: boolean;
}
