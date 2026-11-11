// Зводить номер телефону до одного формату: +380XXXXXXXXX для українських номерів,
// +<цифри> для іноземних. Повертає null, якщо це не схоже на номер.
// Та сама функція є в ERP (backend/src/common/phone.ts): правила мають збігатися,
// інакше пошук клієнта за телефоном не знайде дубль.
export function normalizePhone(input: string): string | null {
  const digits = input.replace(/\D/g, '');

  // 380501234567
  if (digits.length === 12 && digits.startsWith('380')) {
    return `+${digits}`;
  }

  // 0501234567
  if (digits.length === 10 && digits.startsWith('0')) {
    return `+38${digits}`;
  }

  // 80501234567 (старий запис через вісімку)
  if (digits.length === 11 && digits.startsWith('80')) {
    return `+3${digits}`;
  }

  // 501234567 (без коду країни й нуля)
  if (digits.length === 9 && !digits.startsWith('0')) {
    return `+380${digits}`;
  }

  // Іноземний номер: приймаємо лише з явним плюсом на початку.
  if (
    input.trim().startsWith('+') &&
    digits.length >= 10 &&
    digits.length <= 15
  ) {
    return `+${digits}`;
  }

  return null;
}
