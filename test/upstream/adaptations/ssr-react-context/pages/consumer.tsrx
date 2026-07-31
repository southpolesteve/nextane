import * as React from "octane";

const NumberContext = React.createContext(0);

// Octane has no Context.Consumer render-prop API; useContext expresses the
// same subscription the upstream fixture exercises.
function Value() {
  const value = React.useContext(NumberContext);
  return <p>Value: {value}</p>;
}

export default function page() {
  return (
    <NumberContext.Provider value={12345}>
      <Value />
    </NumberContext.Provider>
  );
}

export async function getServerSideProps() {
  return { props: {} };
}
