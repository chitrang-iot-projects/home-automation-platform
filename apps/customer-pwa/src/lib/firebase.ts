import { getApps, initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";

// Public web client configuration — identifies the Firebase project, grants
// no privileged access. Server-side security comes from ID-token verification
// in the API and Firebase security rules.
const firebaseConfig = {
  apiKey: "AIzaSyC34j2I8E9N2dAlmbwcnX6LlEADIgFKLXA",
  authDomain: "home-automation-a86aa.firebaseapp.com",
  projectId: "home-automation-a86aa",
  storageBucket: "home-automation-a86aa.firebasestorage.app",
  messagingSenderId: "605881488904",
  appId: "1:605881488904:web:6eaa8b5971beb5409c23bd",
};

const app = getApps().length > 0 ? getApps()[0] : initializeApp(firebaseConfig);

export const auth = getAuth(app);
