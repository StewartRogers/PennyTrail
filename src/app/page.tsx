import App from "@/components/App";
import { authSettings } from "@/lib/auth";

export default function Home() {
  return <App signOutEnabled={authSettings().mode === "enabled"} />;
}
