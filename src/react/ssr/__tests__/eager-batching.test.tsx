import "../../../testing/internal/messageChannelPolyfill.js";
import React from "react";
import { ApolloClient, InMemoryCache, gql, ApolloLink, Observable } from "@apollo/client";
import { useQuery } from "@apollo/client/react";
import { prerenderStatic } from "../prerenderStatic";
import { renderToString } from "react-dom/server";

const QUERY_A = gql`query A { a }`;
const QUERY_B = gql`query B { b }`;
const QUERY_C = gql`query C { c }`;

function Child() {
  useQuery(QUERY_C);
  return <div>Child</div>;
}

function ComponentA() {
  const { loading } = useQuery(QUERY_A);
  if (loading) return <div>Loading A...</div>;
  return <Child />;
}

function ComponentB() {
  const { loading } = useQuery(QUERY_B);
  if (loading) return <div>Loading B...</div>;
  return <div>B</div>;
}

function App() {
  return (
    <div>
      <ComponentA />
      <ComponentB />
    </div>
  );
}

test("eagerly re-renders when a fast query finishes, even if a slow query is pending", async () => {
  let resolveA: () => void;
  let resolveB: () => void;
  let resolveC: () => void;
  let cRequested = false;

  const link = new ApolloLink((operation) => {
    return new Observable((observer) => {
      const opName = operation.operationName;
      if (opName === "A") {
        resolveA = () => {
          observer.next({ data: { a: "done" } });
          observer.complete();
        };
      } else if (opName === "B") {
        resolveB = () => {
          observer.next({ data: { b: "done" } });
          observer.complete();
        };
      } else if (opName === "C") {
        cRequested = true;
        resolveC = () => {
          observer.next({ data: { c: "done" } });
          observer.complete();
        };
      }
    });
  });

  const client = new ApolloClient({
    cache: new InMemoryCache(),
    link,
  });

  const promise = prerenderStatic({
    tree: <App />,
    context: { client },
    renderFunction: renderToString,
    debounceDelay: 10,
  });

  // Wait for initial render to trigger A and B
  await new Promise(r => setTimeout(r, 20));

  // Resolve A (Fast query)
  if (!resolveA!) throw new Error("resolveA not defined - initial render failed?");
  resolveA();

  // Wait for debounce window (10ms) + some buffer
  await new Promise(r => setTimeout(r, 50));

  // At this point, if eager rendering works, C should have been requested.
  // If it was blocking, C would not be requested because B is still pending.

  if (cRequested) {
    // Great! It worked. Now resolve C.
    if (resolveC!) resolveC();
  }

  // Now resolve B to finish everything
  if (!resolveB!) throw new Error("resolveB not defined - initial render failed?");
  resolveB();

  await promise;

  if (!cRequested) {
    throw new Error("Query C was not requested before Query B finished! Eager batching failed.");
  }
});
