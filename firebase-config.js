/* Wheee!ekend — настройки Firebase.

   Пока enabled: false, приложение работает как раньше: только память телефона.
   После создания проекта Firebase вставьте сюда значения из консоли
   (Project settings → General → Your apps → SDK setup and configuration → Config).

   Эти ключи не секретные: они всё равно видны в браузере у любого
   пользователя. Доступ к данным защищают правила Firestore. */

window.WHEEE_FIREBASE = {
  enabled: true,
  apiKey: "AIzaSyB4vm1LSD_A70awfWRcJ9ugPxZS3Exo89c",
  projectId: "wheeeekend",

  // Обычно менять не нужно. Поля оставлены, чтобы можно было
  // прогнать приложение на локальной заглушке Firebase.
  authBase: "https://identitytoolkit.googleapis.com/v1",
  tokenBase: "https://securetoken.googleapis.com/v1",
  firestoreBase: "https://firestore.googleapis.com/v1"
};
