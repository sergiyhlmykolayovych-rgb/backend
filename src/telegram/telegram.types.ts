// Мінімальні типи оновлень Telegram: лише те, що читає бот.
export interface TelegramChat {
  id: number | string;
  type?: string;
}

export interface TelegramSuccessfulPayment {
  currency: string;
  // У мінімальних одиницях валюти (копійках)
  total_amount: number;
  invoice_payload: string;
  telegram_payment_charge_id: string;
  provider_payment_charge_id?: string;
}

export interface TelegramMessage {
  message_id: number;
  chat: TelegramChat;
  text?: string;
  successful_payment?: TelegramSuccessfulPayment;
}

// Telegram питає перед оплатою, чи можна її провести
export interface TelegramPreCheckoutQuery {
  id: string;
  currency: string;
  total_amount: number;
  invoice_payload: string;
}

export interface TelegramCallbackQuery {
  id: string;
  data?: string;
  message?: TelegramMessage;
}

export interface TelegramUpdate {
  update_id?: number;
  message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
  pre_checkout_query?: TelegramPreCheckoutQuery;
}

export interface InlineButton {
  text: string;
  callback_data?: string;
  url?: string;
}
