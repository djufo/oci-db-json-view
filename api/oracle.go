package dbview

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"time"

	go_ora "github.com/sijms/go-ora/v2"
)

// DBConfig points at the Autonomous Database with the auto-login wallet (no
// Oracle Instant Client — go-ora is pure Go).
type DBConfig struct {
	User              string
	Password          string
	ConnectDescriptor string
	WalletPath        string
}

// DB is a read-only introspection client over an Oracle schema. It only ever
// issues SELECTs against the connected user's own catalog + tables; identifiers
// are validated against the catalog and quoted, so no SQL is built from raw
// user input.
type DB struct{ sql *sql.DB }

// Column is a table column's metadata.
type Column struct {
	Name     string `json:"name"`
	Type     string `json:"type"`
	Nullable bool   `json:"nullable"`
	// JSONish is a hint that this column commonly holds JSON (CLOB/JSON types).
	JSONish bool `json:"jsonish"`
}

var identRE = regexp.MustCompile(`^[A-Za-z0-9_$#]+$`)

// lobTypes / binaryTypes can't be ORDER BY targets / shouldn't be dumped raw.
func isBinaryType(t string) bool {
	t = strings.ToUpper(t)
	return strings.Contains(t, "BLOB") || strings.Contains(t, "RAW") || strings.Contains(t, "LONG RAW")
}
func isLobType(t string) bool {
	t = strings.ToUpper(t)
	return strings.Contains(t, "LOB") || strings.Contains(t, "LONG")
}
func isJSONishType(t string) bool {
	t = strings.ToUpper(t)
	return t == "JSON" || strings.Contains(t, "CLOB")
}

func OpenDB(cfg DBConfig) (*DB, error) {
	if cfg.User == "" || cfg.ConnectDescriptor == "" || cfg.WalletPath == "" {
		return nil, errors.New("oracle: user, connect descriptor and wallet path are required")
	}
	dsn := go_ora.BuildJDBC(cfg.User, cfg.Password, cfg.ConnectDescriptor, map[string]string{
		"SSL":        "enable",
		"SSL Verify": "false",
		"WALLET":     cfg.WalletPath,
	})
	sdb, err := sql.Open("oracle", dsn)
	if err != nil {
		return nil, fmt.Errorf("oracle open: %w", err)
	}
	sdb.SetMaxOpenConns(4)
	sdb.SetConnMaxLifetime(30 * time.Minute)
	if err := sdb.Ping(); err != nil {
		_ = sdb.Close()
		return nil, fmt.Errorf("oracle ping: %w", err)
	}
	return &DB{sql: sdb}, nil
}

func (d *DB) Close() error { return d.sql.Close() }

// TableInfo is a table name + approximate row count.
type TableInfo struct {
	Name string `json:"name"`
	Rows int64  `json:"rows"`
}

// Tables lists the connected user's tables (with row counts from the optimizer
// stats, which is cheap; -1 when unknown).
func (d *DB) Tables(ctx context.Context) ([]TableInfo, error) {
	rows, err := d.sql.QueryContext(ctx,
		`SELECT table_name, NVL(num_rows, -1) FROM user_tables ORDER BY table_name`)
	if err != nil {
		return nil, fmt.Errorf("list tables: %w", err)
	}
	defer rows.Close()
	var out []TableInfo
	for rows.Next() {
		var t TableInfo
		if err := rows.Scan(&t.Name, &t.Rows); err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

// tableExists validates an identifier and confirms it is one of the user's
// tables (prevents injection — the name is otherwise interpolated when quoted).
func (d *DB) tableExists(ctx context.Context, name string) (bool, error) {
	if !identRE.MatchString(name) || len(name) > 128 {
		return false, nil
	}
	var n int
	err := d.sql.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM user_tables WHERE table_name = :1`, strings.ToUpper(name)).Scan(&n)
	return n > 0, err
}

// Columns returns a table's columns in declared order.
func (d *DB) Columns(ctx context.Context, table string) ([]Column, error) {
	ok, err := d.tableExists(ctx, table)
	if err != nil {
		return nil, err
	}
	if !ok {
		return nil, ErrNotFound
	}
	rows, err := d.sql.QueryContext(ctx,
		`SELECT column_name, data_type, nullable FROM user_tab_columns
		 WHERE table_name = :1 ORDER BY column_id`, strings.ToUpper(table))
	if err != nil {
		return nil, fmt.Errorf("columns: %w", err)
	}
	defer rows.Close()
	var cols []Column
	for rows.Next() {
		var name, dtype, nullable string
		if err := rows.Scan(&name, &dtype, &nullable); err != nil {
			return nil, err
		}
		cols = append(cols, Column{Name: name, Type: dtype, Nullable: nullable == "Y", JSONish: isJSONishType(dtype)})
	}
	return cols, rows.Err()
}

// ErrNotFound is returned for unknown tables/columns.
var ErrNotFound = errors.New("not found")

const maxCellBytes = 1 << 20 // cap a single cell's text at 1 MiB

// Page is a slice of a table's rows plus its column metadata + total count.
type Page struct {
	Table   string    `json:"table"`
	Columns []Column  `json:"columns"`
	Rows    [][]*Cell `json:"rows"`
	Total   int64     `json:"total"`
	Page    int       `json:"page"`
	Size    int       `json:"size"`
	Order   string    `json:"order"`
	Dir     string    `json:"dir"`
}

// Cell is one value: null => the whole Cell pointer is nil. V is the formatted
// string value; Bin marks binary/elided content.
type Cell struct {
	V   string `json:"v"`
	Bin bool   `json:"bin,omitempty"`
}

// Count returns the exact row count for a table.
func (d *DB) Count(ctx context.Context, table string) (int64, error) {
	ok, err := d.tableExists(ctx, table)
	if err != nil || !ok {
		return 0, ErrNotFound
	}
	var n int64
	err = d.sql.QueryRowContext(ctx, fmt.Sprintf(`SELECT COUNT(*) FROM "%s"`, strings.ToUpper(table))).Scan(&n)
	return n, err
}

// Rows returns one page of a table. order is an optional column to sort by
// (validated against the table's columns; non-LOB only); default order is ROWID
// so OFFSET/FETCH paging is deterministic.
func (d *DB) Rows(ctx context.Context, table, order, dir string, page, size int) (*Page, error) {
	cols, err := d.Columns(ctx, table)
	if err != nil {
		return nil, err
	}
	if size <= 0 || size > 500 {
		size = 50
	}
	if page < 1 {
		page = 1
	}
	dir = strings.ToUpper(dir)
	if dir != "DESC" {
		dir = "ASC"
	}
	orderSQL := "ROWID"
	resolvedOrder := ""
	if order != "" {
		for _, c := range cols {
			if strings.EqualFold(c.Name, order) && !isLobType(c.Type) && !isBinaryType(c.Type) {
				orderSQL = fmt.Sprintf(`"%s"`, c.Name)
				resolvedOrder = c.Name
				break
			}
		}
	}
	total, err := d.Count(ctx, table)
	if err != nil {
		return nil, err
	}
	offset := (page - 1) * size
	q := fmt.Sprintf(`SELECT %s FROM "%s" ORDER BY %s %s OFFSET :1 ROWS FETCH NEXT :2 ROWS ONLY`,
		selectList(cols), strings.ToUpper(table), orderSQL, dir)
	rs, err := d.sql.QueryContext(ctx, q, offset, size)
	if err != nil {
		return nil, fmt.Errorf("rows: %w", err)
	}
	defer rs.Close()

	n := len(cols)
	var out [][]*Cell
	for rs.Next() {
		dest := make([]any, n)
		for i := range dest {
			dest[i] = new(any)
		}
		if err := rs.Scan(dest...); err != nil {
			return nil, fmt.Errorf("scan: %w", err)
		}
		row := make([]*Cell, n)
		for i := range dest {
			raw := *(dest[i].(*any))
			row[i] = formatCell(raw, cols[i].Type)
		}
		out = append(out, row)
	}
	if err := rs.Err(); err != nil {
		return nil, err
	}
	return &Page{
		Table: strings.ToUpper(table), Columns: cols, Rows: out, Total: total,
		Page: page, Size: size, Order: resolvedOrder, Dir: dir,
	}, nil
}

func selectList(cols []Column) string {
	parts := make([]string, 0, len(cols))
	for _, c := range cols {
		quoted := fmt.Sprintf(`"%s"`, c.Name)
		switch {
		case isBinaryType(c.Type):
			parts = append(parts, fmt.Sprintf(`CASE WHEN %s IS NULL THEN NULL ELSE '[binary ' || DBMS_LOB.GETLENGTH(%s) || ' bytes]' END AS "%s"`, quoted, quoted, c.Name))
		case isLobType(c.Type):
			parts = append(parts, fmt.Sprintf(`DBMS_LOB.SUBSTR(%s, 4000, 1) AS "%s"`, quoted, c.Name))
		default:
			parts = append(parts, quoted)
		}
	}
	return strings.Join(parts, ", ")
}

func formatCell(raw any, dbType string) *Cell {
	if raw == nil {
		return nil // JSON null
	}
	switch v := raw.(type) {
	case []byte:
		if isBinaryType(dbType) {
			return &Cell{V: fmt.Sprintf("[binary %d bytes]", len(v)), Bin: true}
		}
		return clip(string(v))
	case string:
		if isBinaryType(dbType) {
			return &Cell{V: v, Bin: true}
		}
		return clip(v)
	case time.Time:
		return &Cell{V: v.Format(time.RFC3339)}
	case bool:
		if v {
			return &Cell{V: "true"}
		}
		return &Cell{V: "false"}
	default:
		return clip(fmt.Sprintf("%v", v))
	}
}

func clip(s string) *Cell {
	if len(s) > maxCellBytes {
		return &Cell{V: s[:maxCellBytes] + "\n…[truncated]", Bin: false}
	}
	return &Cell{V: s}
}
