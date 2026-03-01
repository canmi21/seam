/* examples/standalone/server-go/procedures/list_users.go */

package procedures

import (
	"context"

	seam "github.com/canmi21/seam/src/server/core/go"
)

type ListUsersInput struct{}

type UserSummary struct {
	ID   uint32 `json:"id"`
	Name string `json:"name"`
}

func ListUsers() seam.ProcedureDef {
	return seam.Query[ListUsersInput, []UserSummary]("listUsers",
		func(ctx context.Context, in ListUsersInput) ([]UserSummary, error) {
			return []UserSummary{
				{ID: 1, Name: "Alice"},
				{ID: 2, Name: "Bob"},
				{ID: 3, Name: "Charlie"},
			}, nil
		})
}
