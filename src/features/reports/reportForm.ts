import {
  MODERATION_REPORT_CATEGORIES,
  type ModerationReportCategory,
} from '../../domain/models';

export interface ReportFormState {
  category: ModerationReportCategory | '';
  description: string;
  files: File[];
}

export interface ReportFormErrors {
  category?: string;
  description?: string;
  files?: string;
}

export const reportCategoryLabels: Record<ModerationReportCategory, string> = {
  suspected_counterfeit: '疑似偽卡',
  listing_mismatch: '商品資訊不符',
  fraud_or_harassment: '詐騙或騷擾',
  prohibited_content: '違禁內容',
  other: '其他',
};

const categories = new Set<string>(MODERATION_REPORT_CATEGORIES);
const evidenceTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);

export function validateReportForm(state: ReportFormState): {
  values: ReportFormState;
  errors: ReportFormErrors;
} {
  const description = state.description.trim();
  const values = { ...state, description, files: [...state.files] };
  const errors: ReportFormErrors = {};
  if (!categories.has(state.category)) errors.category = '請選擇檢舉原因。';
  if (description.length < 1 || description.length > 100) {
    errors.description = '請輸入 1 至 100 字的說明。';
  }
  if (state.files.length > 3) errors.files = '最多上傳 3 張圖片。';
  else if (state.files.some((item) => !evidenceTypes.has(item.type))) {
    errors.files = '附件僅限 JPEG、PNG 或 WebP 圖片。';
  } else if (state.files.some((item) => item.size < 1 || item.size > 5 * 1024 * 1024)) {
    errors.files = '每張圖片不得超過 5 MiB，且不可為空檔案。';
  }
  return { values, errors };
}
