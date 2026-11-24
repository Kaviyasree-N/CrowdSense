import { AlertTriangle, CheckCircle2, Users, Flame } from 'lucide-react';
import { ConfidenceLevel, CrowdingLevel } from '../types/transit';
import { getConfidenceBadgeInfo, getCrowdingStyle } from '../utils/crowdClassification';

interface CrowdBadgeProps {
  level: CrowdingLevel;
  occupancyPct?: number;
  passengerLoad?: number;
  capacity?: number;
  compact?: boolean;
}

export function CrowdBadge({
  level,
  occupancyPct,
  passengerLoad,
  capacity,
  compact = false,
}: CrowdBadgeProps) {
  const style = getCrowdingStyle(level);

  const Icon =
    level === 'Seats Available'
      ? CheckCircle2
      : level === 'Standing Room'
      ? Users
      : level === 'Crowded'
      ? AlertTriangle
      : Flame;

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md border font-medium whitespace-nowrap shrink-0 ${
        compact ? 'px-2 py-0.5 text-xs' : 'px-2.5 py-1 text-xs'
      } ${style.bgClass} ${style.textClass} ${style.borderClass}`}
      title={`${level}: ${style.shortHint}`}
    >
      <Icon className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
      <span>{level}</span>
      {occupancyPct !== undefined && (
        <span className="font-mono-tabular font-semibold">· {occupancyPct}%</span>
      )}
      {passengerLoad !== undefined && capacity !== undefined && (
        <span className="font-mono-tabular opacity-80">
          ({passengerLoad}/{capacity})
        </span>
      )}
    </span>
  );
}

interface ConfidenceTagProps {
  confidence: ConfidenceLevel;
  reason?: string;
}

export function ConfidenceTag({ confidence, reason }: ConfidenceTagProps) {
  const info = getConfidenceBadgeInfo(confidence);
  return (
    <span
      className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded border whitespace-nowrap ${info.bgClass} ${info.textClass} ${info.borderClass}`}
      title={reason ?? info.explanation}
    >
      <span>{info.label}</span>
    </span>
  );
}
