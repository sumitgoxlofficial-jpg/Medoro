import { MarginCalculator } from "@/components/tools/margin-calculator";
import { ToolPage, toolMetadata } from "@/components/tools/tool-page";

export const metadata = toolMetadata("pharma-margin-calculator");

export default function Page() {
  return <ToolPage slug="pharma-margin-calculator"><MarginCalculator /></ToolPage>;
}
