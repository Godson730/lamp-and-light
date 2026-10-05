/* Firebase settings for Lamp & Light groups.
   From Firebase console › Project settings › Your apps › Web app. These values identify the project; they are not
   secret. Access is protected by the Firestore security rules (see firebase/firestore.rules). */
export const projectConfig = {
  apiKey: "AIzaSyBrq_BLrEjBc3OshaHYjZxxkNd0PpFdp48",
  authDomain: "lamp-and-light-7fb99.firebaseapp.com",
  projectId: "lamp-and-light-7fb99",
  storageBucket: "lamp-and-light-7fb99.firebasestorage.app",
  messagingSenderId: "811714063007",
  appId: "1:811714063007:web:502b5f02fc1a730fa610aa"
};

/* The Groups switch.
   null  → the Groups tab shows "Coming soon" (used until the security rules are uploaded to the project)
   projectConfig → Groups are live
   Flip this to `projectConfig` once `firebase deploy --only firestore` has run. */
export const firebaseConfig = projectConfig;

/* Full-length videos in groups.
   false → short clips (up to 10 seconds) stored with the message, works on the free plan
   true  → videos up to 10 minutes / 200 MB stored in Firebase Storage (needs the pay-as-you-go plan)
   Flip this to true once Storage is switched on in the Firebase console and its rules are uploaded. */
export const videoStorage = false;

/* Local testing only: on this PC's test server, run `localStorage.setItem("ll-use-emulator", "1")` in the
   browser console to use the Firebase emulator instead (never used by the Android app or the public website). */
export const emulatorConfig = {
  apiKey: "demo-api-key",
  authDomain: "demo-lamp-and-light.firebaseapp.com",
  projectId: "demo-lamp-and-light",
  storageBucket: "demo-lamp-and-light.firebasestorage.app",
  appId: "demo-app"
};
