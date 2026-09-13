import { initializeApp } from "firebase/app";
import { getFirestore, setLogLevel } from "firebase/firestore";
import config from "../../firebase-applet-config.json";

// Silence internal Firestore network stream logs to avoid dumping circular WebChannel instances
try {
  setLogLevel("silent");
} catch (e) {}

const firebaseConfig = {
  apiKey: config.apiKey,
  authDomain: config.authDomain,
  projectId: config.projectId,
  storageBucket: config.storageBucket,
  messagingSenderId: config.messagingSenderId,
  appId: config.appId,
};

const app = initializeApp(firebaseConfig);
const db = (config as any).firestoreDatabaseId 
  ? getFirestore(app, (config as any).firestoreDatabaseId)
  : getFirestore(app);

export { app, db };
