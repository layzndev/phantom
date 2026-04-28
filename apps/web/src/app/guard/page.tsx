import { redirect } from "next/navigation";

export default function GuardPage() {
  redirect("/guard/overview");
}
