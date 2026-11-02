/** All Hindi lines, merged. One file per area so several people can add lines without clashing. */
import { hi as common } from "./common";
import { hi as shell } from "./shell";
import { hi as auth } from "./auth";
import { hi as pos } from "./pos";
import { hi as stock } from "./stock";
import { hi as purchases } from "./purchases";
import { hi as finance } from "./finance";
import { hi as system } from "./system";
import { hi as device } from "./device";
import { hi as dashboard } from "./dashboard";
import { hi as counter_doctors } from "./counter_doctors";
import { hi as counter_recalls } from "./counter_recalls";
import { hi as counter_cheques } from "./counter_cheques";
import { hi as counter_purchases } from "./counter_purchases";
import { hi as counter_intel } from "./counter_intel";
import { hi as counter_money } from "./counter_money";
import { hi as server } from "./server";
import { hi as site } from "./site";
export const HI: Record<string, string> = {
  ...server,
  ...common,
  ...shell,
  ...auth,
  ...pos,
  ...stock,
  ...purchases,
  ...finance,
  ...system,
  ...device,
  ...dashboard,
  ...counter_doctors,
  ...counter_recalls,
  ...counter_cheques,
  ...counter_purchases,
  ...counter_intel,
  ...counter_money,
  ...site,
};
