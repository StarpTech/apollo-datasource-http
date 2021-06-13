package main

import (
	"log"
	"net/http"
)

func main() {
	// Create a server on port 8000
	// Exactly how you would run an HTTP/1.1 server
	srv := &http.Server{Addr: ":8000", Handler: http.HandlerFunc(handle)}

	// Start the server with TLS, since we are running HTTP/2 it must be
	// run with TLS.
	// Exactly how you would run an HTTP/1.1 server with TLS connection.
	log.Printf("Serving on https://0.0.0.0:8000")
	log.Fatal(srv.ListenAndServeTLS("localhost-cert.pem", "localhost-privkey.pem"))
}

func handle(w http.ResponseWriter, r *http.Request) {
	// Log the request protocol
	// log.Printf("Got connection: %s", r.Proto)
	w.Header().Add("content-type", "application/json")
	// Send a message back to the client
	w.Write([]byte("{}"))
}
