/* examples/standalone/server-go/procedures/get_user.go */

package procedures

import (
	"context"
	"fmt"

	seam "github.com/canmi21/seam/src/server/core/go"
)

type GetUserInput struct {
	ID uint32 `json:"id"`
}

type GetUserOutput struct {
	ID     uint32  `json:"id"`
	Name   string  `json:"name"`
	Email  string  `json:"email"`
	Avatar *string `json:"avatar,omitempty"`
}

type userData struct {
	id     uint32
	name   string
	email  string
	avatar *string
}

func strPtr(s string) *string { return &s }

var users = []userData{
	{id: 1, name: "Alice", email: "alice@example.com", avatar: strPtr("https://example.com/alice.png")},
	{id: 2, name: "Bob", email: "bob@example.com", avatar: nil},
	{id: 3, name: "Charlie", email: "charlie@example.com", avatar: nil},
}

func GetUser() seam.ProcedureDef {
	return seam.Query[GetUserInput, GetUserOutput]("getUser",
		func(ctx context.Context, in GetUserInput) (GetUserOutput, error) {
			for _, u := range users {
				if u.id == in.ID {
					return GetUserOutput{
						ID:     u.id,
						Name:   u.name,
						Email:  u.email,
						Avatar: u.avatar,
					}, nil
				}
			}
			return GetUserOutput{}, seam.NotFoundError(fmt.Sprintf("User %d not found", in.ID))
		})
}
