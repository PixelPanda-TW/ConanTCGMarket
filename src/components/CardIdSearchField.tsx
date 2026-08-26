import { normalizeCardIdQuery } from '../domain/cardId';

interface CardIdSearchFieldProps {
  value: string;
  onChange: (value: string) => void;
  error?: string;
}

const errorId = 'card-id-search-error';

export function CardIdSearchField({ value, onChange, error }: CardIdSearchFieldProps) {
  return (
    <label className="card-id-search-field">
      <span>搜尋卡片 ID</span>
      <input
        aria-describedby={error ? errorId : undefined}
        aria-invalid={error ? 'true' : undefined}
        aria-label="搜尋卡片 ID"
        autoCapitalize="characters"
        maxLength={4}
        onChange={(event) => onChange(normalizeCardIdQuery(event.target.value))}
        spellCheck={false}
        type="text"
        value={value}
      />
      {error && <span className="field-error" id={errorId} role="alert">{error}</span>}
    </label>
  );
}
