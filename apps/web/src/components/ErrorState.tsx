export function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <section className="state-card error-state" role="alert">
      <h2>Something went wrong</h2>
      <p>{message}</p>
      <button className="button button-secondary" onClick={onRetry} type="button">Retry</button>
    </section>
  );
}
