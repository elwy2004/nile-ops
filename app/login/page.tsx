import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import LoginForm from "./form";

export default async function LoginPage() {
  if (await currentUser()) redirect("/quotes");
  return (
    <div className="loginwrap">
      <div className="loginbox">
        <h1>Nile Ops</h1>
        <p className="sub">Quotations from sales through operations to finance.</p>
        <LoginForm />
      </div>
    </div>
  );
}
