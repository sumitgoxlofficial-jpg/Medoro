import { InvoiceGenerator } from "@/components/tools/invoice-generator";
import { ToolPage, toolMetadata } from "@/components/tools/tool-page";

export const metadata = toolMetadata("free-pharmacy-invoice-generator");

export default function Page() {
  return <ToolPage slug="free-pharmacy-invoice-generator"><InvoiceGenerator /></ToolPage>;
}
