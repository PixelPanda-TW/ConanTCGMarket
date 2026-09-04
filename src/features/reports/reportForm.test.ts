import { describe, expect, it } from 'vitest';
import { validateReportForm, type ReportFormState } from './reportForm';

const valid: ReportFormState = {
  category: 'listing_mismatch', description: '卡片稀有度與說明不符', files: [],
};

function file(type: string, size: number): File {
  return new File([new Uint8Array(size)], 'evidence', { type });
}

describe('report form validation', () => {
  it('normalizes a valid description and accepts zero to three approved images', () => {
    expect(validateReportForm({ ...valid, description: '  卡片不符  ' })).toEqual({
      values: { ...valid, description: '卡片不符' }, errors: {},
    });
    expect(validateReportForm({
      ...valid,
      files: [file('image/jpeg', 1), file('image/png', 5 * 1024 * 1024), file('image/webp', 2)],
    }).errors).toEqual({});
  });

  it.each([
    ['missing category', { category: '' }, '請選擇檢舉原因'],
    ['blank description', { description: '   ' }, '請輸入 1 至 100 字'],
    ['long description', { description: '字'.repeat(101) }, '請輸入 1 至 100 字'],
    ['too many images', { files: [file('image/png', 1), file('image/png', 1), file('image/png', 1), file('image/png', 1)] }, '最多上傳 3 張'],
    ['wrong type', { files: [file('application/pdf', 1)] }, 'JPEG、PNG 或 WebP'],
    ['oversized', { files: [file('image/png', 5 * 1024 * 1024 + 1)] }, '每張圖片不得超過 5 MiB'],
  ])('rejects %s', (_label, override, message) => {
    const result = validateReportForm({ ...valid, ...override } as ReportFormState);
    expect(JSON.stringify(result.errors)).toContain(message);
  });
});
