// Placeholders of «Прогноз» and «Активность», part of the first paint (lazy.tsx) and shown again
// by the lazy components while their queries run: the same boxes as the loaded ones, so nothing
// below them moves.

/**
 * The forecast line's place, empty: its box at the height of one line of text (a line that wraps
 * to two grows by a few pixels only). The line itself fades in over it.
 */
export function ForecastPlaceholder() {
  return <div className="forecast-line forecast-line--placeholder" aria-hidden="true" />;
}

/** The heat map's frame without data: months row, weekday column, the grid box, the caption line. */
export function HeatmapSkeleton() {
  return (
    <div className="heatmap-content" aria-hidden="true">
      <div className="heatmap">
        <div className="heatmap-months" />
        <div className="heatmap-body">
          <div className="heatmap-weekdays" />
          <div className="heatmap-grid" />
        </div>
      </div>
      <div className="heatmap-foot">
        <span className="heatmap-caption">{' '}</span>
      </div>
    </div>
  );
}
