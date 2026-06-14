// Command server runs oci-db-json-view as a standalone service (the same library
// any project can also embed). It connects to the Oracle ADB via go-ora + wallet
// and serves the API + UI on PORT.
package main

import (
	"log/slog"
	"net/http"
	"os"

	dbview "github.com/djufo/oci-db-json-view"
)

func main() {
	port := getenv("PORT", "6210")

	db, err := dbview.OpenDB(dbview.DBConfig{
		User:              os.Getenv("ORA_USER"),
		Password:          os.Getenv("ORA_PASSWORD"),
		ConnectDescriptor: os.Getenv("ORA_CONNECT_DESCRIPTOR"),
		WalletPath:        getenv("ORA_WALLET", os.Getenv("TNS_ADMIN")),
	})
	if err != nil {
		slog.Error("open oracle", "error", err)
		os.Exit(1)
	}
	defer db.Close()

	password := os.Getenv("DBVIEW_PASSWORD")
	if password == "" {
		slog.Warn("DBVIEW_PASSWORD is not set — the database browser is OPEN (no auth)")
	}

	h := dbview.New(dbview.Config{
		DB:       db,
		Password: password,
		Secret:   []byte(os.Getenv("DBVIEW_COOKIE_SECRET")),
	})
	addr := ":" + port
	slog.Info("oci-db-json-view listening", "addr", addr, "authRequired", password != "")
	if err := http.ListenAndServe(addr, h); err != nil {
		slog.Error("server stopped", "error", err)
		os.Exit(1)
	}
}

func getenv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
