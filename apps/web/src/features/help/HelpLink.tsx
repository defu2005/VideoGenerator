import { featureForPathname, helpHref } from "@vg/shared";
import { Link, useLocation } from "react-router-dom";

export function HelpLink() {
  const { pathname } = useLocation();
  const feature = featureForPathname(pathname);
  if (!feature) return null;
  return (
    <Link
      className="help-context-link"
      to={helpHref(feature)}
      aria-label="Hướng dẫn cho trang này"
      title="Hướng dẫn"
      data-testid="context-help"
    >
      ?
    </Link>
  );
}
