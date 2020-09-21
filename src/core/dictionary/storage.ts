export const adapter = {
    get: (value: string) => window.localStorage.getItem(value),
    set: (key: string, value: string) => window.localStorage.setItem(key, value),
};

