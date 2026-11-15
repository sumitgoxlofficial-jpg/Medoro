import { HsnFinder } from "@/components/tools/hsn-finder";
import { ToolPage, toolMetadata } from "@/components/tools/tool-page";

export const metadata = toolMetadata("medicine-hsn-code-finder");

export default function Page() {
  return <ToolPage slug="medicine-hsn-code-finder"><HsnFinder /></ToolPage>;
}
