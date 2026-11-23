// Exercise the real library handler without Oracle (no API calls are expected).
package main

import (
	dbview "github.com/djufo/oci-db-json-view/api"
	"log"
	"net/http"
	"os"
)

func main() {
	handler := dbview.NewServer(nil, "", nil, os.DirFS(os.Args[2])).Handler()
	log.Fatal(http.ListenAndServe(os.Args[1], handler))
}
