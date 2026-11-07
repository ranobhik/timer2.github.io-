/* Значения по умолчанию для ключей API.
   Сайт статический, поэтому ключи всё равно уезжают в браузер зрителя:
   здесь они лежат, чтобы всё работало сразу после открытия сайта.
   Ключи можно переопределить в админке — «Настройки сайта» → «Ключи API»
   (значения из localStorage важнее этих). Если ключ утёк или исчерпан —
   замените строку ниже и опубликуйте сайт заново. */

export const DEFAULT_KEYS = {
  kodikToken: "d6a9c41c60eae7abeb43f91ea50e2302",
  kinopoiskToken: "5TXZNZC-33YMWQ4-KWGK3FR-JPNN4G1",
  cvhToken:
    "eyJhbGciOiJFUzUxMiIsInR5cCI6IkpXVCJ9.eyJhZG1pbiI6ZmFsc2UsImlhdCI6MTc5MjU3NzgyNCwidWlkIjoiemxvLXJhbm9iIn0."
    + "AcRJ6CdMHhJNv1coMtfSU9EKFOwUyJMh2uiPNL-N96kbKQLqvCcuaSVxNytlsH2Rs_xzeRHD3gzjNqv8kza6y0dnACwAM3i6737n6f0CnYpGBt188Yofm-6HwnqkJHJx0gxuqqrZsaWv387mDcZ4rY1unA2Pa0aUMzlKK31vfq08elrh",
};
