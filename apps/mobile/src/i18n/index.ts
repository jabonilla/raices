import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import en from "./en.json";
import es from "./es.json";

void i18n.use(initReactI18next).init({
  lng: "es-US",
  fallbackLng: "en-US",
  resources: {
    "es-US": { translation: es },
    es: { translation: es },
    "en-US": { translation: en },
    en: { translation: en },
  },
  interpolation: { escapeValue: false },
});

export default i18n;
