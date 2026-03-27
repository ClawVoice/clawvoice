declare module "@clack/prompts" {
  export const intro: (message: string) => void;
  export const outro: (message: string) => void;
  export const cancel: (message: string) => void;
  export const isCancel: (value: unknown) => boolean;
  export const note: (message: string, title?: string) => void;

  export type SelectOption = {
    value: string;
    label: string;
    hint?: string;
  };

  export type TextOptions = {
    message: string;
    placeholder?: string;
    validate?: (value: string) => string | void;
  };

  export type ConfirmOptions = {
    message: string;
    initialValue?: boolean;
  };

  export const select: (options: {
    message: string;
    initialValue?: string;
    options: SelectOption[];
  }) => Promise<string | symbol>;

  export const text: (options: TextOptions) => Promise<string | symbol>;
  export const password: (options: TextOptions) => Promise<string | symbol>;
  export const confirm: (options: ConfirmOptions) => Promise<boolean | symbol>;

  export const spinner: () => {
    start: (message: string) => void;
    stop: (message?: string) => void;
  };

  export const log: {
    info: (message: string) => void;
    success: (message: string) => void;
    warn: (message: string) => void;
    error: (message: string) => void;
  };
}
